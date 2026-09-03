const { asyncWrapper, sendSuccess } = require("../../utils");
const { getBanner } = require("../../services/banners");

exports.get = asyncWrapper(async (req, res) => {
  const result = await getBanner(req.validatedData.id);
  return sendSuccess(res, 200, "Banner fetched successfully.", result);
});
