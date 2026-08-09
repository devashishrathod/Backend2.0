const { asyncWrapper, sendSuccess } = require("../../utils");
const { replaceSectionMedia } = require("../../services/showcases");

exports.replaceMedia = asyncWrapper(async (req, res) => {
  const result = await replaceSectionMedia(
    req.userId,
    req.validatedData,
    req.files?.file,
  );
  return sendSuccess(res, 200, "Media replaced successfully.", result);
});
