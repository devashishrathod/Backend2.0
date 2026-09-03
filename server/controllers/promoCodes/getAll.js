const { asyncWrapper, sendSuccess } = require("../../utils");
const { getAllPromoCodes } = require("../../services/promoCodes");

exports.getAll = asyncWrapper(async (req, res) => {
  const result = await getAllPromoCodes(req.validatedData);
  return sendSuccess(res, 200, "Promo codes fetched successfully", result);
});
