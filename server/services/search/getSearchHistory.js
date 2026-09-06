const SearchHistory = require("../../models/SearchHistory");
const { getCustomerConfig } = require("../../helpers/settings");

/**
 * One customer's recent searches, newest first.
 *
 * ⚠️ An empty list is a `200`, never a `404`. A customer who has not searched
 * yet is in a perfectly normal state, and a 404 there would put an error screen
 * in front of somebody on their first day.
 */
exports.getSearchHistory = async (customerId, query = {}) => {
  const config = (await getCustomerConfig()).search;
  const limit = Math.min(query.limit || config.historyLimit, 100);

  const rows = await SearchHistory.find({ customerId, isDeleted: false })
    .sort({ lastSearchedAt: -1 })
    .limit(limit)
    .select("query searchCount lastSearchedAt")
    .lean();

  return rows;
};
