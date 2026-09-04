const { asyncWrapper, sendSuccess } = require("../../utils");
const { clearSearchHistory } = require("../../services/search");
const { resolveCustomerId } = require("../../helpers/customers");

exports.clearSearchHistory = asyncWrapper(async (req, res) => {
  const result = await clearSearchHistory(resolveCustomerId(req));
  return sendSuccess(res, 200, "Search history cleared", result);
});
