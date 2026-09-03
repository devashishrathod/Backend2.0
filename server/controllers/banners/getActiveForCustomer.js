const { asyncWrapper, sendSuccess } = require("../../utils");
const { getActiveBannerForCustomer } = require("../../services/banners");

exports.getActiveForCustomer = asyncWrapper(async (req, res) => {
  const result = await getActiveBannerForCustomer();
  return sendSuccess(
    res,
    200,
    result ? "Active banner fetched successfully." : "No active banner found.",
    result,
  );
});
