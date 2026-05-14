const Brand = require("../../model/Brand");
const { findOne } = require("../../db/dbServices");

exports.getBrandByUserAndVendorId = async (brandId, userId) => {
  return await findOne(Brand, { _id: brandId, user: userId, isDeleted: false });
};
