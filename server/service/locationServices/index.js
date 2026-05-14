const { createLacation } = require("./addLocation");
const { getLocationBySubBrandId } = require("./getLocationBySubBrandId");
const {
  getLocationByUserAndBrandId,
} = require("./getLocationByUserAndBrandId");
const {
  getLocationByBrandAndSubBrandAddress,
} = require("./getLocationByBrandAndSubBrandAddress");
const { updateLocationByFields } = require("./updateLocationByFields");

module.exports = {
  createLacation,
  getLocationBySubBrandId,
  getLocationByUserAndBrandId,
  getLocationByBrandAndSubBrandAddress,
  updateLocationByFields,
};
