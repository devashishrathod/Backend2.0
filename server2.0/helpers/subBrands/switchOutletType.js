const { switchSlot } = require("../brands/entitlementSlots");
const { bucketFor } = require("./reserveOutletSlot");

/**
 * Move one outlet between the outlet and franchise pools.
 *
 * Because the two pools are metered separately, changing `outletType` is not a
 * cosmetic edit — it frees a slot in one pool and must claim one in the other.
 * The claim uses the same atomic filter as creation, so a switch cannot
 * overshoot the target pool's limit even under concurrency.
 *
 * If the caller's subsequent SubBrand write fails it must call `revert()`.
 *
 * @returns {{ brand: object, revert: function }}
 */
exports.switchOutletType = (brandId, fromType, toType) =>
  switchSlot(brandId, bucketFor(fromType), bucketFor(toType));
