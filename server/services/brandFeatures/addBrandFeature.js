const BrandFeatures = require("../../models/BrandFeatures");
const { resolveActorBrand } = require("../../helpers/brands");
const { throwError } = require("../../utils");
const { uploadImage } = require("../uploads");

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
  let iconUrl;
  try {
    iconUrl = await uploadImage(icon.tempFilePath);
  } catch (error) {
    console.error("Error on uploading feature icon", error.message);
    throwError(500, "Failed to upload feature icon!");
  }
  return await BrandFeatures.create({
    brandId: brand._id,
    title,
    description,
    icon: iconUrl,
    isActive: typeof isActive === "string" ? isActive === "true" : isActive,
  });
};
