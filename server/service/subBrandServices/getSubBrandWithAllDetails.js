const SubBrand = require("../../model/SubBrand");

exports.getSubBrandWithAllDetails = async (id) => {
  return await SubBrand.findOne({ _id: id, isDeleted: false }).populate(
    "user brand location workHours"
  );
};
