const { asyncWrapper, sendSuccess } = require("../../utils");
const { getPromoCode } = require("../../services/promoCodes");

exports.get = asyncWrapper(async (req, res) => {
  const result = await getPromoCode(req.validatedData.id);
  return sendSuccess(res, 200, "Promo code fetched successfully", result);
});
