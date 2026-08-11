const BrandFeatures = require("../../models/BrandFeatures");
const Brand = require("../../models/Brand");
const { throwError } = require("../../utils");
const { uploadImage } = require("../uploads");

exports.addBrandFeature = async (payload, icon) => {
  const { brandId, title, description, isActive = true } = payload;
  const brand = await Brand.findOne({ _id: brandId, isDeleted: false });
  if (!brand) throwError(404, "Brand not found!");

  if (isActive === true || isActive === "true") {
    const activeFeatureCount = await BrandFeatures.countDocuments({
      brandId,
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
    brandId,
    title,
    description,
    icon: iconUrl,
    isActive: typeof isActive === "string" ? isActive === "true" : isActive,
  });
};
