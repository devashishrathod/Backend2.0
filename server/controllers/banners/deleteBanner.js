const { asyncWrapper, sendSuccess } = require("../../utils");
const { deleteBanner } = require("../../services/banners");

exports.deleteBanner = asyncWrapper(async (req, res) => {
  await deleteBanner(req.userId, req.validatedData.id);
  return sendSuccess(res, 200, "Banner deleted successfully.");
});
