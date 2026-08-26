const { addOrUpdateBasicDetails } = require("./addOrUpdateBasicDetails");
const { acceptPartnership } = require("./acceptPartnership");
const { getBrand } = require("./getBrand");
const {
  getCustomerBrand,
  MEDIA_PREVIEW_PER_SECTION,
} = require("./getCustomerBrand");
const { updateBrand } = require("./updateBrand");

module.exports = {
  addOrUpdateBasicDetails,
  acceptPartnership,
  getBrand,
  getCustomerBrand,
  MEDIA_PREVIEW_PER_SECTION,
  updateBrand,
};
