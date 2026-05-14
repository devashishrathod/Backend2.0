const User = require("../../model/User");
const { findOne } = require("../../db/dbServices");

exports.getUserById = async (id) => {
  return await findOne(User, { _id: id, isDeleted: false });
};
