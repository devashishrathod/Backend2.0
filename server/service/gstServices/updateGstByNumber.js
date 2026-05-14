const Gst = require("../../model/Gst");
const { findOneAndUpdate } = require("../../db/dbServices");

exports.updateGstByNumber = async (gstNumber, updateData) => {
  return await findOneAndUpdate(Gst, gstNumber, updateData);
};
