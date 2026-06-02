const { asyncWrapper, sendSuccess } = require("../../utils");
const { getBanner } = require("../../services/banners");

exports.get = asyncWrapper(async (req, res) => {
  const Banner = await getBanner(req.params?.id);
  return sendSuccess(res, 200, "Banner fetched successfully", Banner);
});
