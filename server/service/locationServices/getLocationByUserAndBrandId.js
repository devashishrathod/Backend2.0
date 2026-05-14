const Location = require("../../model/Location");
const { findOne } = require("../../db/dbServices");

exports.getLocationByUserAndBrandId = async (brandId, userId) => {
  return await findOne(Location, {
    brand: brandId,
    user: userId,
    isDeleted: false,
  });
};
