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

  if (typeof payload.isActive === "boolean") {
    setting.isActive = payload.isActive;
  }
  setting.updatedBy = userId;

  await setting.save();
  return setting;
};
