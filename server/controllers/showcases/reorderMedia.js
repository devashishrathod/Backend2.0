const { asyncWrapper, sendSuccess } = require("../../utils");
const { reorderSectionMedia } = require("../../services/showcases");

exports.reorderMedia = asyncWrapper(async (req, res) => {
  const result = await reorderSectionMedia(
    { userId: req.userId, role: req.role, brandId: req.brandId }, req.validatedData);
  return sendSuccess(res, 200, "Media reordered successfully.", result);
});
