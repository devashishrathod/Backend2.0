const { asyncWrapper, sendSuccess } = require("../../utils");
const { replaceSectionMedia } = require("../../services/showcases");

exports.replaceMedia = asyncWrapper(async (req, res) => {
  const result = await replaceSectionMedia(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    req.validatedData,
    req.files?.file,
    // ⚠️ Required when the replacement is a video — nothing derives a poster.
    req.files?.thumbnail,
  );
  return sendSuccess(res, 200, "Media replaced successfully.", result);
});
