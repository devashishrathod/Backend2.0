const { addOrUpdateBasicDetails } = require("./addOrUpdateBasicDetails");
const { acceptPartnership } = require("./acceptPartnership");
const { getBrand } = require("./getBrand");
const {
  getCustomerBrand,
} = require("./getCustomerBrand");
const { getAllCustomerBrands } = require("./getAllCustomerBrands");
const { getAllAdminBrands } = require("./getAllAdminBrands");
const { getTopBrands } = require("./getTopBrands");
const { reviewTopBrand } = require("./reviewTopBrand");
const { toggleBrandStatus } = require("./toggleBrandStatus");
const { updateBrand } = require("./updateBrand");

module.exports = {
  addOrUpdateBasicDetails,
  acceptPartnership,
  getBrand,
  getCustomerBrand,
  getAllCustomerBrands,
  getAllAdminBrands,
  getTopBrands,
  reviewTopBrand,
  toggleBrandStatus,
  updateBrand,
};
