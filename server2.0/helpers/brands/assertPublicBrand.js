const mongoose = require("mongoose");
const Brand = require("../../models/Brand");
const { throwError } = require("../../utils");

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
  const exists = await Brand.exists({ _id, isActive: true, isDeleted: false });
  if (!exists) throwError(404, "Brand not found");

  return _id;
};
