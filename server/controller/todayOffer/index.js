const { addTodayOffer } = require("./addTodayOffer");
const { getTodayOfferCategories } = require("./getTodayOfferCategories");
const { getTodayOffersAllVouchers } = require("./getTodayOffersAllVouchers");
const { getAllOffers } = require("./getAllOffers");

module.exports = {
  addTodayOffer,
  getAllOffers,
  getTodayOfferCategories,
  getTodayOffersAllVouchers,
};
