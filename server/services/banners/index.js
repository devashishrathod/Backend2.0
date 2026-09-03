const { createBanner } = require("./createBanner");
const { getBanner } = require("./getBanner");
const { getAllBanners } = require("./getAllBanners");
const { updateBanner } = require("./updateBanner");
const { deleteBanner } = require("./deleteBanner");
const { getActiveBannerForCustomer } = require("./getActiveBannerForCustomer");

module.exports = {
  createBanner,
  getBanner,
  getAllBanners,
  updateBanner,
  deleteBanner,
  getActiveBannerForCustomer,
};
