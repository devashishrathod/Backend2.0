const { asyncWrapper, sendSuccess } = require("../../utils");
const { deleteSearchQuery } = require("../../service/searchHistoryServices");

exports.deleteSearchHistory = asyncWrapper(async (req, res, next) => {
  const userId = req.payload?._id;
  const { queryId } = req.params;
  await deleteSearchQuery(userId, queryId);
  return sendSuccess(res, 200, "Search history deleted successfully");
});
