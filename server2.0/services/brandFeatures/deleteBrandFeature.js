const BrandFeatures = require("../../models/BrandFeatures");
const { throwError } = require("../../utils");
const { deleteImage } = require("../uploads");

exports.deleteBrandFeature = async (featureId) => {
  const feature = await BrandFeatures.findOne({
    _id: featureId,
    isDeleted: false,
  });
  if (!feature) throwError(404, "Brand feature not found!");
  feature.isDeleted = true;
  feature.isActive = false;
  await feature.save();
  if (feature.icon) {
    try {
      await deleteImage(feature.icon);
    } catch (error) {
      console.error("Failed to delete feature icon:", error);
    }
  }
  return;
};
