const { OUTLET_TYPES } = require("../../constants");
const { ENTITLEMENT_BUCKETS } = require("../../constants/subscription");
const {
  reserveSlot,
  bucketLabel,
} = require("../brands/entitlementSlots");

/**
 * Which plan pool an outlet type draws on. Outlets and franchises are separate
 * quotas — neither borrows from the other.
 */
const bucketFor = (outletType) =>
  outletType === OUTLET_TYPES.FRANCHISE
    ? ENTITLEMENT_BUCKETS.FRANCHISES
    : ENTITLEMENT_BUCKETS.SUB_BRANDS;

/**
 * Atomically claim one outlet or franchise slot.
 *
 * Thin wrapper over the generic `reserveSlot`, which every metered bucket
 * shares, so the concurrency rule and the 403 wording live in one place.
 */
exports.reserveOutletSlot = (brandId, outletType) =>
  reserveSlot(brandId, bucketFor(outletType));

exports.bucketFor = bucketFor;
exports.bucketNoun = (bucket) => bucketLabel(bucket).one;
