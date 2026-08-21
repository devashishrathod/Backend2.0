const { asyncWrapper, sendSuccess } = require("../../utils");
const { updateBanner } = require("../../services/banners");

exports.update = asyncWrapper(async (req, res) => {
  const { id, ...payload } = req.validatedData;
  const result = await updateBanner(req.userId, id, payload, req.files);
  return sendSuccess(res, 200, "Banner updated successfully.", result);
});
