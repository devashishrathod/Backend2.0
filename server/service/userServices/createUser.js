const User = require("../../model/User");
const { createItem } = require("../../db/dbServices");

exports.createUser = async (payload) => {
  return await createItem(User, payload);
};
