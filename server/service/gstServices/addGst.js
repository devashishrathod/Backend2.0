const Gst = require("../../model/Gst");
const { createItem } = require("../../db/dbServices");

exports.addGst = async (payload) => {
  return await createItem(Gst, payload);
};
