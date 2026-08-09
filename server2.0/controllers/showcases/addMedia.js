const { asyncWrapper, sendSuccess } = require("../../utils");
const { addSectionMedia } = require("../../services/showcases");

exports.addMedia = asyncWrapper(async (req, res) => {
  const result = await addSectionMedia(
    req.userId,
    req.validatedData,
    req.files,
  );
  return sendSuccess(res, 201, "Media uploaded successfully.", result);
});
