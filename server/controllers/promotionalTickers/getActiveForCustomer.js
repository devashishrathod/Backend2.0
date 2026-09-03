const { asyncWrapper, sendSuccess } = require("../../utils");
const {
  getActiveTickersForCustomer,
} = require("../../services/promotionalTickers");

exports.getActiveForCustomer = asyncWrapper(async (req, res) => {
  const result = await getActiveTickersForCustomer();
  return sendSuccess(
    res,
    200,
    "Active promotional tickers fetched successfully.",
    result,
  );
});
