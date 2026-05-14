const Brand = require("../../model/Brand");
const { findOneAndUpdate } = require("../../db/dbServices");

exports.updateBrandById = async (id, updatedData) => {
  return await findOneAndUpdate(
    Brand,
    { _id: id, isDeleted: false },
    updatedData
  );
};
