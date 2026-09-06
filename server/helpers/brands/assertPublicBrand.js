const mongoose = require("mongoose");
const Brand = require("../../models/Brand");
const { throwError } = require("../../utils");
const { customerVisibleBrandFilter } = require("./customerVisibleBrand");

/**
 * Assert that a brand is one a customer is allowed to read, and return its id.
 *
 * The customer showcase endpoints took `brandId` straight into a `$match`, so a
 * deleted or deactivated brand kept serving its gallery and its video clips —
 * the brand had been switched off everywhere else on the app, but this content
 * stayed public. A non-existent id answered `200` with an empty list, which
 * also made a typo indistinguishable from a brand with no albums.
 *
 * Returns the ObjectId so callers can drop it straight into a pipeline.
 *
 * @param {string} brandId
 * @returns {Promise<mongoose.Types.ObjectId>}
 */
exports.assertPublicBrand = async (brandId) => {
  if (!mongoose.Types.ObjectId.isValid(brandId)) {
    throwError(400, "Invalid brand ID");
  }

  const _id = new mongoose.Types.ObjectId(brandId);
  /**
   * ⚠️ Now includes **verified**, not only live.
   *
   * This checked `isActive` and `isDeleted` and stopped there, so a brand that
   * had never been through verification — or one whose approval was revoked —
   * kept serving its gallery and its video clips to customers. Same shape as
   * the bug this helper was written for: switched off in one place, still
   * public in another.
   *
   * `customerVisibleBrandFilter` is the single definition; every customer
   * surface reads it, so they cannot drift apart again.
   */
  const exists = await Brand.exists(customerVisibleBrandFilter({ _id }));
  if (!exists) throwError(404, "Brand not found");

  return _id;
};
