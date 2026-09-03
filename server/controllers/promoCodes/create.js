const { asyncWrapper, sendSuccess } = require("../../utils");
const { createPromoCode } = require("../../services/promoCodes");

exports.create = asyncWrapper(async (req, res) => {
  const result = await createPromoCode(req.userId, req.validatedData);
  return sendSuccess(res, 201, "Promo code created successfully", result);
});
