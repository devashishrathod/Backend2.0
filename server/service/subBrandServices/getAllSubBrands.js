const SubBrand = require("../../model/SubBrand");

exports.getAllSubBrands = async () => {
  return await SubBrand.find({ isDeleted: false })
    .sort({ createdAt: -1 })
    .populate("user brand location workHours");
};
