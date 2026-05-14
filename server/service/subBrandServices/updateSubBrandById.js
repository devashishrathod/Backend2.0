const SubBrand = require("../../model/SubBrand");
const { findOneAndUpdate } = require("../../db/dbServices");

exports.updateSubBrandById = async (id, updatedData) => {
  return await findOneAndUpdate(
    SubBrand,
    { _id: id, isDeleted: false },
    updatedData
  );
};
