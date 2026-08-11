const BrandFeatures = require("../../models/BrandFeatures");
const { throwError } = require("../../utils");

exports.getBrandFeature = async (featureId) => {
  const feature = await BrandFeatures.findOne({
    _id: featureId,
    isDeleted: false,
  }).lean();
  if (!feature) throwError(404, "Brand feature not found!");
  return feature;
};
