const { globalSearch } = require("./globalSearch");
const { getSearchHistory } = require("./getSearchHistory");
const { deleteSearchHistoryEntry } = require("./deleteSearchHistoryEntry");
const { clearSearchHistory } = require("./clearSearchHistory");
const { getPopularSearches } = require("./getPopularSearches");

module.exports = {
  globalSearch,
  getSearchHistory,
  deleteSearchHistoryEntry,
  clearSearchHistory,
  getPopularSearches,
};
