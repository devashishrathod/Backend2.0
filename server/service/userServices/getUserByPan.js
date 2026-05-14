const User = require("../../model/User");
const { findOne } = require("../../db/dbServices");

exports.getUserByPan = async (panNumber) => {
  return await findOne(User, { panNumber: panNumber, isDeleted: false });
};
