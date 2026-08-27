const { addOrUpdateBasicDetails } = require("./addOrUpdateBasicDetails");
const { acceptPartnership } = require("./acceptPartnership");
const { getBrand } = require("./getBrand");
const {
  getCustomerBrand,
  MEDIA_PREVIEW_PER_SECTION,
} = require("./getCustomerBrand");
const { getAllCustomerBrands } = require("./getAllCustomerBrands");
const { getTopBrands } = require("./getTopBrands");
const { reviewTopBrand } = require("./reviewTopBrand");
const { updateBrand } = require("./updateBrand");

module.exports = {
  addOrUpdateBasicDetails,
  acceptPartnership,
  getBrand,
  getCustomerBrand,
  getAllCustomerBrands,
  getTopBrands,
  reviewTopBrand,
  MEDIA_PREVIEW_PER_SECTION,
  updateBrand,
};
