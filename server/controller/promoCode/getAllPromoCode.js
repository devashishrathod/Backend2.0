const { sendSuccess, sendError } = require("../../utils");
const { getAllCodes } = require("../../service/promoCodeServices");

exports.getAllPromoCode = async (req, res) => {
  try {
    const result = await getAllCodes(req.query);
    if (!result || result.total === 0) {
      return sendError(res, 404, "No promo codes available");
    }
    return sendSuccess(res, 200, "Promo codes fetched successfully", result);
  } catch (err) {
    console.error("Error fetching promo codes:", err);
    return sendError(res, 500, "Failed to fetch promo codes", err.message);
  }
};
