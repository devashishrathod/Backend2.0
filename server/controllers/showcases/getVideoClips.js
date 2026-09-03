const { asyncWrapper, sendSuccess } = require("../../utils");
const { getAllVideoClips } = require("../../services/showcases");

exports.getVideoClips = asyncWrapper(async (req, res) => {
  const result = await getAllVideoClips(req.validatedData);
  return sendSuccess(res, 200, "Video clips fetched successfully.", result);
});
