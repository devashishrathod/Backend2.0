const { asyncWrapper, sendSuccess } = require("../../utils");
const { searchQuery } = require("../../service/searchHistoryServices");

exports.globalSearch = asyncWrapper(async (req, res, next) => {
  const tokenUserId = req.payload?._id;
  const { userId, query, page, limit } = req.query;
  const results = await searchQuery(tokenUserId, userId, query, page, limit);
  sendSuccess(res, 200, "Search results", results);
});
