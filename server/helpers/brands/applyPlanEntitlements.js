const Brand = require("../../models/Brand");
const {
  EXPIRED_ENTITLEMENTS,
  ENTITLEMENT_SOURCE,
  METERED_ENTITLEMENTS,
  BUCKET_BRAND_FIELDS,
} = require("../../constants/subscription");
const { resolveEntitlements } = require("../subscriptions");
const { recountBrandUsage } = require("./recountBrandUsage");

/**
 * Push a plan's entitlements onto the brand's limit fields.
 *
 * This is the *only* writer of the `*Limit` and `is*Unlimited` fields across all
 * four metered pools. Every path that changes what a brand is entitled to
 * funnels through here — activation, renewal, upgrade, downgrade, admin grant,
 * expiry and cancellation — so the limits can never disagree with the live plan.
 *
 * Usage counters are recounted from the owning collections first, so a plan
 * change also repairs any drift.
 *
 * Passing `subscription: null` applies EXPIRED_ENTITLEMENTS: nothing new can be
 * created, but no existing outlet, voucher or showcase section is ever touched.
 *
 * @param {string|object} brandId
 * @param {object|null}   subscription  the plan doc, or null when there is none
 * @returns {{ entitlements, source, warnings, usage, overflow }}
 */
exports.applyPlanEntitlements = async (brandId, subscription) => {
  const { entitlements, source, warnings } = subscription
    ? resolveEntitlements(subscription)
    : {
        entitlements: EXPIRED_ENTITLEMENTS,
        source: ENTITLEMENT_SOURCE.DEFAULT,
        warnings: [],
      };

  // Reconcile before writing limits so the overflow report below is truthful.
  const usage = await recountBrandUsage(brandId);

  const $set = { entitlementsSyncedAt: new Date() };
  for (const bucket of METERED_ENTITLEMENTS) {
    const fields = BUCKET_BRAND_FIELDS[bucket];
    const granted = entitlements[bucket] || { limit: 0, isUnlimited: false };
    $set[fields.limit] = granted.limit ?? 0;
    $set[fields.isUnlimited] = Boolean(granted.isUnlimited);
  }

  await Brand.updateOne({ _id: brandId }, { $set });

  for (const warning of warnings) console.warn(`[entitlements] ${warning}`);

  // Existing rows are grandfathered rather than deleted, so after a downgrade
  // `used` can legitimately exceed `limit`. Report it per bucket so the caller
  // can warn the admin, and so no new slot is handed out until it clears.
  const overflow = {};
  for (const bucket of METERED_ENTITLEMENTS) {
    const fields = BUCKET_BRAND_FIELDS[bucket];
    const granted = entitlements[bucket] || { limit: 0, isUnlimited: false };
    const used = usage[fields.used] ?? 0;
    overflow[bucket] = granted.isUnlimited
      ? 0
      : Math.max(0, used - (granted.limit ?? 0));
  }

  return { entitlements, source, warnings, usage, overflow };
};
