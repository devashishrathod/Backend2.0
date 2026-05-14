const Location = require("../../model/Location");
const { findOneAndUpdate } = require("../../db/dbServices");

exports.updateLocationByFields = async (filter, updateData) => {
  return await findOneAndUpdate(Location, filter, updateData);
};
