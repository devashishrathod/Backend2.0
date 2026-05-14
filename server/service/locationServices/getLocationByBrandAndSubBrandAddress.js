const Location = require("../../model/Location");
const { findOne } = require("../../db/dbServices");

exports.getLocationByBrandAndSubBrandAddress = async (
  brandId,
  userId,
  shopOrBuildingNumber
) => {
  return await findOne(Location, {
    brand: brandId,
    user: userId,
    shopOrBuildingNumber: shopOrBuildingNumber,
    isDeleted: false,
  });
};
