const User = require("../../model/User");
const { findOne } = require("../../db/dbServices");
const { ROLES } = require("../../constants");

exports.getBrandOrSubBrandUserById = async (id) => {
  return await findOne(User, {
    _id: id,
    isDeleted: false,
    role: { $in: [ROLES.VENDOR, ROLES.SUB_VENDOR] },
  });
};
