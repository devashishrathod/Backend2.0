const SubBrand = require("../../model/SubBrand");

exports.getSubBrandById = async (id) => {
  return await SubBrand.findOne({ isDeleted: false, _id: id }).populate(
    "user brand location workHours"
  );
};
