const { asyncWrapper, sendSuccess } = require("../../utils");
const { deleteTicker } = require("../../services/promotionalTickers");

exports.deleteTicker = asyncWrapper(async (req, res) => {
  await deleteTicker(req.userId, req.validatedData.id);
  return sendSuccess(res, 200, "Promotional ticker deleted successfully.");
});
