const SearchHistory = require("../../models/SearchHistory");
const { throwError, validateObjectId } = require("../../utils");

/**
 * Remove one remembered search.
 *
 * ⚠️ `customerId` is part of the filter, not checked afterwards. Without it any
 * signed-in customer could pass someone else's row id and delete their history
 * one entry at a time.
 *
 * A row belonging to somebody else answers **404**, not 403. "That exists but is
 * not yours" confirms the id is real, which is itself something a stranger
 * should not be able to learn by guessing.
 */
exports.deleteSearchHistoryById = async (customerId, historyId) => {
  validateObjectId(historyId, "History Id");

  const entry = await SearchHistory.findOneAndUpdate(
    { _id: historyId, customerId, isDeleted: false },
    { $set: { isDeleted: true } },
  );

  if (!entry) throwError(404, "Search history entry not found");
  return;
};
