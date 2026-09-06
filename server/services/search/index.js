const { globalSearch } = require("./globalSearch");
const { getSearchHistory } = require("./getSearchHistory");
const { deleteSearchHistoryById } = require("./deleteSearchHistoryById");
const { clearSearchHistory } = require("./clearSearchHistory");
const { getPopularSearches } = require("./getPopularSearches");

module.exports = {
  globalSearch,
  getSearchHistory,
  deleteSearchHistoryById,
  clearSearchHistory,
  getPopularSearches,
};
