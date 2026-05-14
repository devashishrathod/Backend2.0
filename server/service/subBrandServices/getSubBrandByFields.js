const SubBrand = require("../../model/SubBrand");
const { findOne } = require("../../db/dbServices");

exports.getSubBrandByFields = async (fieldsData) => {
  const filter = { isDeleted: false, ...fieldsData };
  return await findOne(SubBrand, filter);
};
