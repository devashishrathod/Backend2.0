const { asyncWrapper, sendSuccess } = require("../../utils");
const {
  getRecentSearchQueries,
} = require("../../service/searchHistoryServices");

exports.getRecentSearchHistory = asyncWrapper(async (req, res, next) => {
  const tokenUserId = req.payload?._id;
  const { userId, page, limit } = req.query;
  const results = await getRecentSearchQueries(
    tokenUserId,
    userId,
    page,
    limit
  );
  return sendSuccess(
    res,
    200,
    "Recent search history fetched successfully",
    results
  );
});
