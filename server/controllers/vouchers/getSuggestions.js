const { asyncWrapper, sendSuccess } = require("../../utils");
const { getSuggestedVouchers } = require("../../services/vouchers");

exports.getSuggestions = asyncWrapper(async (req, res) => {
  const result = await getSuggestedVouchers(req.validatedData);
  return sendSuccess(
    res,
    200,
    "Suggested vouchers fetched successfully.",
    result,
  );
});
