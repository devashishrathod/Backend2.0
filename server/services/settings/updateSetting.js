const {
  getSetting,
  assertSettlementTimingRule,
} = require("../../helpers/settings");

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
  const setting = await getSetting();

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
    for (const key of [
      "minVersion",
      "latestVersion",
      "storeUrl",
      "support",
      "features",
    ]) {
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
  setting.updatedBy = userId;

  await setting.save();
  return setting;
};
