const { asyncWrapper, sendSuccess } = require("../../utils");
const { createBanner } = require("../../services/banners");

exports.create = asyncWrapper(async (req, res) => {
  const result = await createBanner(req.userId, req.validatedData, req.files);
  return sendSuccess(res, 201, "Banner created successfully.", result);
});
