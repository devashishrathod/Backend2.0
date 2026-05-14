const { getAllVendors } = require("./getAllVendors");
const { addBrand } = require("./addBrandAsVendor");
const { updateBrand } = require("./updateBrand");
const { activeOrInactiveBrand } = require("./activeOrInactiveBrand");

module.exports = {
  getAllVendors,
  addBrand,
  updateBrand,
  activeOrInactiveBrand,
};
