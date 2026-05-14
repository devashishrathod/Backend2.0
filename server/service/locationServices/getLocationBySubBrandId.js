const Location = require("../../model/Location");
const { findOne } = require("../../db/dbServices");

exports.getLocationBySubBrandId = async (subBrandId) => {
  return await findOne(Location, { subBrand: subBrandId, isDeleted: false });
};
