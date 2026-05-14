const { addSubBrand } = require("./addSubBrand");
const { updateSubBrand } = require("./updateSubBrand");
const { getAllSubBrands } = require("./getAllSubBrands");
const { getAllSubBrandsOfBrand } = require("./getAllSubBrandsOfBrand");
const {
  createInitialSubBrandForBrand,
} = require("./createInitialSubBrandForBrand");
const { signUpSubBrandWithMobile } = require("./signUpSubBrandWithMobile");

module.exports = {
  addSubBrand,
  updateSubBrand,
  getAllSubBrands,
  getAllSubBrandsOfBrand,
  createInitialSubBrandForBrand,
  signUpSubBrandWithMobile,
};
