const { asyncWrapper, sendSuccess } = require("../../utils");
const { deletePromoCode } = require("../../services/promoCodes");

exports.deletePromo = asyncWrapper(async (req, res) => {
  const result = await deletePromoCode(req.userId, req.validatedData.id);
  return sendSuccess(res, 200, "Promo code deleted successfully", result);
});
