const { asyncWrapper, sendSuccess } = require("../../utils");
const { deleteSearchHistoryById } = require("../../services/search");
const { resolveCustomerId } = require("../../helpers/customers");

exports.deleteSearchHistoryEntry = asyncWrapper(async (req, res) => {
  await deleteSearchHistoryById(
    resolveCustomerId(req),
    req.params?.historyId,
  );
  return sendSuccess(res, 200, "Search history entry removed");
});
