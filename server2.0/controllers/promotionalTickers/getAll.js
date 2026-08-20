const { asyncWrapper, sendSuccess } = require("../../utils");
const { getAllTickers } = require("../../services/promotionalTickers");

exports.getAll = asyncWrapper(async (req, res) => {
  const result = await getAllTickers(req.validatedData);
  return sendSuccess(
    res,
    200,
    "Promotional tickers fetched successfully.",
    result,
  );
});
