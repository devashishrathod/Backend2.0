const mongoose = require("mongoose");

const BrandFeatures = require("../../models/BrandFeatures");
const { resolveActorBrand } = require("../../helpers/brands");
const { throwError } = require("../../utils");
const storage = require("../storage");
const { UPLOAD_PURPOSE } = require("../../constants/storage");

/**
 * @param {{ userId: string, role: string, brandId?: string }} actor
 * @param {object} payload  carries `brandId` — required, and now verified
 */
exports.addBrandFeature = async (actor, payload, icon) => {
  const { brandId, title, description, isActive = true } = payload;

  /**
   * Was `Brand.findOne({ _id: brandId })` — which asked whether the brand
   * exists, never whether the caller owns it. `brandId` arrives in the body, so
   * any vendor could add a feature to any brand simply by naming it. The route
   * gate (`isVendorOrAdmin`) only established that the caller was *a* vendor.
   *
   * `resolveActorBrand` is the same check the showcase, voucher and
   * subscription writes use: an admin may name any brand, a vendor only their
   * own, and ownership is read off the brand rather than trusted from the token.
   */
  const brand = await resolveActorBrand(actor, brandId);

  if (isActive === true || isActive === "true") {
    const activeFeatureCount = await BrandFeatures.countDocuments({
      brandId: brand._id,
      isActive: true,
      isDeleted: false,
    });
    if (activeFeatureCount >= 10) {
      throwError(400, "A brand can have maximum 10 active features!");
    }
  }

  if (!icon) throwError(400, "Feature icon is required!");

  // Minted up front: the icon's key carries the feature id, and the upload has
  // to happen before the row exists.
  const _id = new mongoose.Types.ObjectId();

  let iconUrl;
  try {
    iconUrl = await storage.uploadUrl({
      filePath: icon.tempFilePath,
      originalFile: icon,
      purpose: UPLOAD_PURPOSE.BRAND_FEATURE_ICON,
      entityId: _id,
    });
  } catch (error) {
    console.error("Error on uploading feature icon", error.message);
    throwError(500, "Failed to upload feature icon!");
  }
  return await BrandFeatures.create({
    _id,
    brandId: brand._id,
    title,
    description,
    icon: iconUrl,
    isActive: typeof isActive === "string" ? isActive === "true" : isActive,
  });
};
