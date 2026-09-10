const { createBanner } = require("./createBanner");
const { getBanner } = require("./getBanner");
const { getAllBanners } = require("./getAllBanners");
const { updateBanner } = require("./updateBanner");
const { deleteBanner } = require("./deleteBanner");
const {
  getActiveBannersForCustomer,
} = require("./getActiveBannersForCustomer");

module.exports = {
  createBanner,
  getBanner,
  getAllBanners,
  updateBanner,
  deleteBanner,
  getActiveBannersForCustomer,
};
