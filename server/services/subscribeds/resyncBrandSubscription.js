const Brand = require("../../models/Brand");
const { throwError } = require("../../utils");
const { syncBrandSubscriptionState } = require("../../helpers/subscribeds");

/**
 * Admin repair: rebuild a brand's cached subscription state and limits from
 * scratch.
 *
 * Recomputes the live plan from the Subscribed documents, re-applies the plan's
 * entitlements, and recounts outlet/franchise usage from the SubBrand rows.
 * Needed when data has been edited directly in the DB, or after a crash between
 * an atomic slot reserve and the SubBrand insert.
 *
 * Purely corrective — it changes no plan, no date and no outlet, so it is safe
 * to run against any brand at any time.
 */
exports.resyncBrandSubscription = async (payload = {}) => {
  const { brandId } = payload;

  const brand = await Brand.findById(brandId).select("_id isDeleted").lean();
  if (!brand || brand.isDeleted) throwError(404, "Brand not found!");

  const before = await Brand.findById(brandId)
    .select(
      "isSubscribed subscribedId subBrandsLimit subBrandsUsed franchisesLimit franchisesUsed",
    )
    .lean();

  const sync = await syncBrandSubscriptionState(brandId);

  const after = await Brand.findById(brandId)
    .select(
      "isSubscribed subscribedId subBrandsLimit subBrandsUsed franchisesLimit franchisesUsed entitlementsSyncedAt",
    )
    .lean();

  return {
    before,
    after,
    isSubscribed: sync.isSubscribed,
    entitlements: sync.entitlements,
    entitlementsSource: sync.source,
    entitlementWarnings: sync.warnings,
    // True when the usage counters had drifted from the actual SubBrand rows.
    countersDrifted: sync.usage?.drifted ?? false,
    overflow: sync.overflow,
  };
};
