const SearchHistory = require("../../models/SearchHistory");

/**
 * Clear one customer's whole search history.
 *
 * ⚠️ Already-empty is a success, not an error. The customer asked for their
 * history to be gone and it is gone — telling them "there was nothing to
 * delete" answers a question they did not ask, with an error screen.
 */
exports.clearSearchHistory = async (customerId) => {
  const result = await SearchHistory.updateMany(
    { customerId, isDeleted: false },
    { $set: { isDeleted: true } },
  );

  return { deletedCount: result.modifiedCount ?? 0 };
};
