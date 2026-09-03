const { asyncWrapper, sendSuccess } = require("../../utils");
const { getBrandSubscription } = require("../../services/subscribeds");

exports.get = asyncWrapper(async (req, res) => {
  const result = await getBrandSubscription(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    req.validatedData,
  );
  return sendSuccess(
    res,
    200,
    "Brand subscription details fetched successfully",
    result,
  );
});
