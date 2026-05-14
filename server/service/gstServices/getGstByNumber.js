const Gst = require("../../model/Gst");
const { findOne } = require("../../db/dbServices");

exports.getGstByNumber = async (gstNumber) => {
  return await findOne(Gst, { gstNumber: gstNumber, isDeleted: false });
};
