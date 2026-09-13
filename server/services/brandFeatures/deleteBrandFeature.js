const BrandFeatures = require("../../models/BrandFeatures");
const { resolveActorBrand } = require("../../helpers/brands");
const { throwError } = require("../../utils");
const storage = require("../storage");

/**
 * @param {{ userId: string, role: string, brandId?: string }} actor
 */
exports.deleteBrandFeature = async (actor, featureId) => {
  const feature = await BrandFeatures.findOne({
    _id: featureId,
    isDeleted: false,
  });
  if (!feature) throwError(404, "Brand feature not found!");

  /**
   * Nothing checked ownership here at all — the feature was found by id and
   * deleted, and its icon destroyed with it. Any vendor could remove any
   * brand's features one id at a time, and the asset does not come back.
   */
  await resolveActorBrand(actor, feature.brandId);

  feature.isDeleted = true;
  feature.isActive = false;
  await feature.save();
  if (feature.icon) {
    try {
      await storage.deleteAsset({
        url: feature.icon,
        storage: feature.iconStorage,
      });
    } catch (error) {
      console.error("Failed to delete feature icon:", error);
    }
  }
  return;
};
