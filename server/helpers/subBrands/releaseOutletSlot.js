const { releaseSlot } = require("../brands/entitlementSlots");
const { bucketFor } = require("./reserveOutletSlot");

/**
 * Give a reserved outlet / franchise slot back.
 *
 * Called when something downstream of a successful reserve fails — the OTP
 * provider is down, the SubBrand insert throws — so a failed signup does not
 * permanently eat a slot from the vendor's plan.
 */
exports.releaseOutletSlot = (brandId, outletType) =>
  releaseSlot(brandId, bucketFor(outletType));
