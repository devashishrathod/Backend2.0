const SubBrand = require("../../model/SubBrand");

exports.getAllSubBrandsOfOneBrand = async (brandId) => {
  return await SubBrand.find({ isDeleted: false, brand: brandId })
    .sort({ createdAt: -1 })
    .populate("user brand location workHours");
};
