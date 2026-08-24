const { asyncWrapper, sendSuccess } = require("../../utils");
const { getPromoCodeReport } = require("../../services/promoCodes");

exports.report = asyncWrapper(async (req, res) => {
  const result = await getPromoCodeReport(req.validatedData);
  return sendSuccess(
    res,
    200,
    "Promo code report generated successfully",
    result,
  );
});
