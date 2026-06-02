const { asyncWrapper, sendSuccess } = require("../../utils");
const { deleteBanner } = require("../../services/banners");

exports.deleteBanner = asyncWrapper(async (req, res) => {
  await deleteBanner(req.params?.id);
  return sendSuccess(res, 200, "Banner deleted successfully");
});
