const Brand = require("../../model/Brand");
const { findOne } = require("../../db/dbServices");

exports.getBrandByName = async (name) => {
  return await findOne(Brand, { name: name, isDeleted: false });
};
