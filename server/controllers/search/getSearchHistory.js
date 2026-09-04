const { asyncWrapper, sendSuccess } = require("../../utils");
const { getSearchHistory } = require("../../services/search");
const { resolveCustomerId } = require("../../helpers/customers");

exports.getSearchHistory = asyncWrapper(async (req, res) => {
  const history = await getSearchHistory(resolveCustomerId(req), req.query);
  return sendSuccess(res, 200, "Search history fetched", history);
});
