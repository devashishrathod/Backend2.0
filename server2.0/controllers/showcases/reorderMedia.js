const { asyncWrapper, sendSuccess } = require("../../utils");
const { reorderSectionMedia } = require("../../services/showcases");

exports.reorderMedia = asyncWrapper(async (req, res) => {
  const result = await reorderSectionMedia(req.userId, req.validatedData);
  return sendSuccess(res, 200, "Media reordered successfully.", result);
});
