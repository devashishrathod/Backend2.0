const { asyncWrapper, sendSuccess } = require("../../utils");
const { getAllBanners } = require("../../services/banners");

exports.getAll = asyncWrapper(async (req, res) => {
  const result = await getAllBanners(req.validatedData);
  return sendSuccess(res, 200, "Banners fetched successfully.", result);
});
