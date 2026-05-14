const { createTodayOffer } = require("./createTodayOffer");
const { getAllTodayOfferCategories } = require("./getAllTodayOfferCategories");
const { getTodayOffersByCategory } = require("./getTodayOffersByCategory");
const { getAllTodayOffers } = require("./getAllTodayOffers");
const { generateUniqueTodayOfferId } = require("./generateUniqueTodayOfferId");

module.exports = {
  createTodayOffer,
  getAllTodayOfferCategories,
  getTodayOffersByCategory,
  getAllTodayOffers,
  generateUniqueTodayOfferId,
};
