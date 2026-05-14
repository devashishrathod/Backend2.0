const User = require("../../model/User");
const { findByIdAndUpdate } = require("../../db/dbServices");

exports.updateUserById = async (id, updatedData) => {
  return await findByIdAndUpdate(User, id, updatedData);
};
