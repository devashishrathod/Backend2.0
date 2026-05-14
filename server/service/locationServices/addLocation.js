const Location = require("../../model/Location");
const { createItem } = require("../../db/dbServices");

exports.createLacation = async (payload) => {
  return await createItem(Location, payload);
};
