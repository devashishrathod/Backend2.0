const {
  getSettingDocument,
  invalidateSettingCache,
  assertSettlementTimingRule,
  assertReserveRateRule,
  assertStorageLimitRule,
  assertShowcaseFloorRule,
  assertVoucherFloorRule,
} = require("../../helpers/settings");
const {
  checkS3Ready,
  PROVIDERS_NEEDING_PREFLIGHT,
} = require("../storage/preflight");
const { throwError } = require("../../utils");

/**
 * Sub-blocks under `Setting.customer`, each merged independently.
 *
 * Listed rather than derived so adding a block is a deliberate edit here — a
 * block that exists in the schema and the validator but is missing from this
 * list would validate cleanly, return 200, and save nothing.
 */
const CUSTOMER_BLOCKS = Object.freeze([
  "convenienceFee",
  "tax",
  "promoCode",
  "claim",
  "notification",
  "invoice",
  "settlement",
  "refund",
  "chargeback",
  "search",
]);

/**
 * Blocks that contain a block of their own.
 *
 * These have to be peeled off before the parent is merged. `Object.assign` on a
 * Mongoose sub-document replaces a nested path wholesale, so assigning
 * `{ reserve: { percent: 15 } }` onto `settlement` re-creates `reserve` from its
 * schema defaults and silently drops `holdDays` and `riskChargebackCount` —
 * verified against the live schema, which reset them from 45/3 back to 30/2.
 */
const NESTED_BLOCKS = Object.freeze({
  settlement: ["reserve"],
});

/**
 * The sub-blocks under `app`, merged one at a time.
 *
 * Named rather than left inline for the same reason `CUSTOMER_BLOCKS` is: a
 * block missing from the list validates cleanly, returns `200` and saves
 * nothing, and the only thing that can notice is a test comparing the list
 * against the schema — which needs the list to have a name.
 *
 * `forceUpdate` and `updateMessage` are scalars and are assigned below on their
 * own; everything else under `app` is an object.
 */
const APP_BLOCKS = Object.freeze([
  "minVersion",
  "latestVersion",
  "storeUrl",
  "support",
  "features",
]);

/**
 * Merge a payload block onto the stored sub-document.
 *
 * The sub-document may not exist yet: a Mongoose default applies on **write**,
 * so the singleton Setting doc created before a block was added has no such path
 * and `Object.assign(undefined, …)` would throw. Assigning `{}` first lets the
 * schema materialise it with its defaults, then the payload lands on top.
 *
 * Any sub-block named in `NESTED_BLOCKS` is held back from the parent assign and
 * merged into afterwards, so a PATCH of one nested field leaves its siblings
 * alone exactly like a top-level one does.
 */
const mergeBlock = (parent, key, incoming, nestedKeys = []) => {
  if (!incoming) return;
  if (!parent[key]) parent[key] = {};

  const flat = { ...incoming };
  const nested = {};
  for (const nestedKey of nestedKeys) {
    if (flat[nestedKey] === undefined) continue;
    nested[nestedKey] = flat[nestedKey];
    delete flat[nestedKey];
  }

  Object.assign(parent[key], flat);

  for (const [nestedKey, value] of Object.entries(nested)) {
    mergeBlock(parent[key], nestedKey, value);
  }
};

exports.updateSetting = async (userId, payload = {}) => {
  /**
   * ⚠️ The live document, not the cached snapshot. Everything below
   * `Object.assign`s onto it and then saves — mutating the shared snapshot
   * instead would show readers a half-built update, and keep showing it even if
   * the save were to fail validation.
   */
  const setting = await getSettingDocument();
  /** Non-fatal notes from a provider switch, returned so the panel can show them. */
  const preflightWarnings = [];

  if (payload.vendor?.voucher) {
    Object.assign(setting.vendor.voucher, payload.vendor.voucher);
  }
  if (payload.vendor?.showcase) {
    Object.assign(setting.vendor.showcase, payload.vendor.showcase);
  }
  if (payload.vendor?.subscription) {
    // Merged, not replaced, so an admin can PATCH just the GST rate without
    // resetting the seller identity and every policy flag to their defaults.
    Object.assign(setting.vendor.subscription, payload.vendor.subscription);
  }

  if (payload.customer) {
    if (!setting.customer) setting.customer = {};

    for (const block of CUSTOMER_BLOCKS) {
      mergeBlock(
        setting.customer,
        block,
        payload.customer[block],
        NESTED_BLOCKS[block],
      );
    }

    // Runs on the MERGED document, after the assigns and before the save. A
    // request validator cannot do this: a PATCH raising only `refund.windowHours`
    // carries no `settlement` block to compare it against, and the rule would
    // break silently. Throws 422 — a wrong value here only shows up as a broken
    // reconciliation weeks later.
    assertSettlementTimingRule(setting.customer);

    /**
     * ⚠️ The same shape of rule, one block down: a reserve rate that could never
     * be applied.
     *
     * `buildReserveRiskMap` caps every rate with `Math.min(percent, maxPercent)`,
     * so `maxPercent: 3` beside `percent: 5` holds 3% from everybody while the
     * panel, the stored document and `GET /settings/get` all keep saying 5. Same
     * reason it cannot live in Joi: a PATCH carrying only `maxPercent` has no
     * `percent` to compare against.
     */
    assertReserveRateRule(setting.customer);
  }

  /**
   * ⚠️ Merged, not assigned.
   *
   * `Object.assign` on the parent would drop every sibling a PATCH did not
   * mention — the same bug that once reset `settlement.reserve.holdDays` from 45
   * to 30 because the request only carried `percent`. Someone raising
   * `maxPerHour` alone must not silently lose a cooldown an admin had tuned.
   */
  if (payload.security?.otp) {
    if (!setting.security) setting.security = {};
    if (!setting.security.otp) setting.security.otp = {};
    Object.assign(setting.security.otp, payload.security.otp);
  }

  /**
   * The admin audience's outbound channels.
   *
   * ⚠️ Merged, and the "sub-document does not exist yet" case is the **normal**
   * one here: `Setting.admin` was added long after these documents were written,
   * so the live row has no `admin` key at all. Mongoose hydrates the defaults on
   * read — which is why `GET /settings` already shows the block and
   * `getAdminConfig()` already returns the right values — but nothing is stored
   * until the first write lands here.
   *
   * ⚠️ Three audiences, three blocks, none able to silence another. Putting these
   * flags anywhere near `vendor.subscription` is what made switching off renewal
   * reminders also switch off every admin money alert.
   */
  if (payload.admin?.notification) {
    if (!setting.admin) setting.admin = {};
    if (!setting.admin.notification) setting.admin.notification = {};
    Object.assign(setting.admin.notification, payload.admin.notification);
  }

  /**
   * The public block.
   *
   * ⚠️ Merged nested-block-by-nested-block for the same reason as the others: an
   * `Object.assign` on `setting.app` would drop `support` the moment somebody
   * PATCHed only `features` — and the support number vanishing is exactly the
   * kind of loss nobody notices until a stuck customer has nowhere to write.
   *
   * `mergeBlock` handles the "sub-document does not exist yet" case, which is
   * the normal state here: `Setting.app` was added after these documents were
   * written, so every existing row has no `app` at all.
   */
  if (payload.app) {
    if (!setting.app) setting.app = {};
    for (const key of APP_BLOCKS) {
      if (payload.app[key]) mergeBlock(setting.app, key, payload.app[key]);
    }
    if (typeof payload.app.forceUpdate === "boolean") {
      setting.app.forceUpdate = payload.app.forceUpdate;
    }
    if (typeof payload.app.updateMessage === "string") {
      setting.app.updateMessage = payload.app.updateMessage;
    }
  }

  if (typeof payload.isActive === "boolean") {
    setting.isActive = payload.isActive;
  }
  /**
   * Platform-wide storage rules. Merged block by block, same as everything
   * else, so an admin can change the provider without resetting the limits.
   */
  if (payload.storage) {
    if (!setting.storage) setting.storage = {};

    if (payload.storage.provider) {
      /**
       * 🔴 A provider switch is rehearsed before it is saved.
       *
       * This one dropdown redirects **every upload on the platform**. If the
       * credentials are wrong or the policy was never attached, nothing fails
       * here — it fails at the next upload, for every user at once, with a
       * stack trace that says nothing about a settings change made an hour ago.
       *
       * An env var at least needed someone with deploy access. A dropdown does
       * not, so the dropdown gets a rehearsal instead: a real write, read and
       * delete in both buckets. See `services/storage/preflight.js` for why no
       * read-only check can answer this.
       *
       * ⚠️ Only when the value is actually **changing**. Re-saving the same
       * provider as part of an unrelated edit should not pay for a round trip
       * to S3, and should not be able to fail because of one.
       */
      const changing = payload.storage.provider !== setting.storage.provider;
      if (changing && PROVIDERS_NEEDING_PREFLIGHT.includes(payload.storage.provider)) {
        const { ok, reason, warnings } = await checkS3Ready();
        if (!ok) {
          throwError(
            422,
            `Cannot switch to ${payload.storage.provider}: ${reason}`,
          );
        }
        preflightWarnings.push(...warnings);
      }
      setting.storage.provider = payload.storage.provider;
    }
    for (const block of ["limits", "allowed", "upload", "delivery"]) {
      if (payload.storage[block]) {
        mergeBlock(setting.storage, block, payload.storage[block]);
      }
    }
  }

  /**
   * ⚠️ After every merge, on the **merged** document. The global ceiling and a
   * surface limit can arrive in separate requests, so checking the payload
   * alone would miss an admin lowering the global below a surface that is
   * already stored.
   */
  assertStorageLimitRule(setting);
  // Same reasoning, different pair: a section's floor and its ceiling can also
  // arrive in separate requests.
  assertShowcaseFloorRule(setting);
  // And a voucher's image floor against its own ceiling (V-1).
  assertVoucherFloorRule(setting);

  setting.updatedBy = userId;

  await setting.save();

  /**
   * After the save, never before. Dropping it first would let a reader arriving
   * in between cache the **old** values for another full TTL — the one window
   * where a stale read is surprising rather than merely late.
   */
  invalidateSettingCache();

  /**
   * ⚠️ Always this shape, never sometimes-this-sometimes-that.
   *
   * Warnings ride back rather than being logged and lost — "S3 is on but
   * CloudFront is not" is something the person who just flipped the switch has
   * to read, and they are not watching server output. But returning them only
   * when present would give the caller two shapes to handle, so the list is
   * always here and usually empty.
   *
   * The **HTTP** response does not move: the controller still sends the setting
   * as `data` and folds any warning into the message.
   */
  return { setting, warnings: preflightWarnings };
};

/**
 * Exported for the surface guard in `__tests__/money/settingsSurface.test.js`,
 * which compares each list against the schema it is supposed to mirror. Every
 * one of them is a hand-written list whose failure mode is a silent `200`, so
 * comparing them to the schema is the only thing that can catch a drift.
 */
exports.CUSTOMER_BLOCKS = CUSTOMER_BLOCKS;
exports.NESTED_BLOCKS = NESTED_BLOCKS;
exports.APP_BLOCKS = APP_BLOCKS;
