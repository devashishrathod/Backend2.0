const Brand = require("../../models/Brand");
const { throwError } = require("../../utils");

exports.validateBrandVendor = async (userId) => {
  const brand = await Brand.findOne({
    userId,
    isDeleted: false,
    isActive: true,
  }).select("_id");
  if (!brand) throwError(404, "Brand not found.");
  return brand;
};
