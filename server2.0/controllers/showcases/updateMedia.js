const { asyncWrapper, sendSuccess } = require("../../utils");
const { updateSectionMedia } = require("../../services/showcases");

exports.updateMedia = asyncWrapper(async (req, res) => {
  const result = await updateSectionMedia(
    req.userId,
    req.validatedData,
    req.files?.thumbnail,
  );
  return sendSuccess(res, 200, "Media info updated successfully.", result);
});
