const Subscribed = require("../../model/Subscribed");
const { createItem } = require("../../db/dbServices");

exports.createSubscribed = async (payload) => {
  return await createItem(Subscribed, payload);
};
