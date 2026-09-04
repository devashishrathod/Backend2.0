const { asyncWrapper, sendSuccess } = require("../../utils");
const { getPopularSearches } = require("../../services/search");

exports.getPopularSearches = asyncWrapper(async (req, res) => {
  const result = await getPopularSearches();
  return sendSuccess(res, 200, "Popular searches fetched", result);
});
