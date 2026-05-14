const { createCode } = require("../../service/promoCodeServices");
const { sendError, sendSuccess } = require("../../utils");
const {
  validateCreatePromoCode,
} = require("../../validator/validate.promoCode");

exports.createPromoCode = async (req, res) => {
  try {
    const { error, value } = validateCreatePromoCode(req.body);
    if (error) {
      return sendError(
        res,
        422,
        error.details.map((d) => d.message).join(", ")
      );
    }
    const promoCode = await createCode(value);
    return sendSuccess(res, 201, "Promo code created successfully", promoCode);
  } catch (err) {
    console.log("error on creating promoCode", err);
    const statusCode = err.statusCode || 500;
    return sendError(res, statusCode, err.message);
  }
};
