const { asyncWrapper, sendSuccess } = require("../../utils");
const { updatePromoCode } = require("../../services/promoCodes");

exports.update = asyncWrapper(async (req, res) => {
  const { id, ...payload } = req.validatedData;
  const result = await updatePromoCode(req.userId, id, payload);
  return sendSuccess(res, 200, "Promo code updated successfully", result);
});
