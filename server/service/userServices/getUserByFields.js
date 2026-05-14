const User = require("../../model/User");
const { findOne } = require("../../db/dbServices");

exports.getUserByFields = async (fieldsData) => {
  const filter = { isDeleted: false, ...fieldsData };
  return await findOne(User, filter);
};
