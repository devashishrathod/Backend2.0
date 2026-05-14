const Brand = require("../../model/Brand");
const { findOne } = require("../../db/dbServices");

exports.getBrandById = async (id) => {
  return await findOne(Brand, { _id: id, isDeleted: false });
};
