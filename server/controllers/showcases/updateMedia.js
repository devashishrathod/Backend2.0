const { asyncWrapper, sendSuccess } = require("../../utils");
const { updateSectionMedia } = require("../../services/showcases");

exports.updateMedia = asyncWrapper(async (req, res) => {
  const result = await updateSectionMedia(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    req.validatedData,
    req.files?.thumbnail,
  );
  return sendSuccess(res, 200, "Media info updated successfully.", result);
});
