const BrandFeatures = require("../../models/BrandFeatures");
const Brand = require("../../models/Brand");
const { uploadImage, deleteImage } = require("../uploads");

exports.updateBrandFeature = async (payload, icon) => {
  const { featureId, title, description, isActive } = payload;
  const feature = await BrandFeatures.findOne({
    _id: featureId,
    isDeleted: false,
  });
  if (!feature) throwError(404, "Brand feature not found!");

  const brand = await Brand.exists({ _id: feature.brandId, isDeleted: false });
  if (!brand) throwError(404, "Brand not found!");

  const requestedActive =
    isActive === undefined
      ? feature.isActive
      : typeof isActive === "string"
        ? isActive === "true"
        : isActive;

  if (requestedActive === true && feature.isActive === false) {
    const activeFeatureCount = await BrandFeatures.countDocuments({
      brandId: feature.brandId,
      isActive: true,
      isDeleted: false,
      _id: { $ne: featureId },
    });
    if (activeFeatureCount >= 10) {
      throwError(400, "A brand can have maximum 10 active features!");
    }
  }

  if (title) feature.title = title;
  if (description) feature.description = description;
  if (isActive) feature.isActive = requestedActive;

  if (icon) {
    const oldIcon = feature.icon;
    const newIcon = await uploadImage(icon.tempFilePath);
    feature.icon = newIcon;
    await feature.save();
    if (oldIcon) {
      try {
        await deleteImage(oldIcon);
      } catch (error) {
        console.error("Failed to delete old feature icon:", error);
      }
    }
    return feature;
  }
  await feature.save();
  return feature;
};
