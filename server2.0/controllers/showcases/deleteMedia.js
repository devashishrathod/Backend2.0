const { asyncWrapper, sendSuccess } = require("../../utils");
const { deleteSectionMedia } = require("../../services/showcases");

exports.deleteMedia = asyncWrapper(async (req, res) => {
  const result = await deleteSectionMedia(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    req.validatedData,
  );
  return sendSuccess(res, 200, "Media deleted successfully.", result);
});
