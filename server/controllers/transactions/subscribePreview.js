const { asyncWrapper, sendSuccess } = require("../../utils");
const { previewSubscribeOrder } = require("../../services/transactions");

exports.subscribePreview = asyncWrapper(async (req, res) => {
  const result = await previewSubscribeOrder(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    req.validatedData,
  );
  return sendSuccess(
    res,
    200,
    "Subscription checkout preview fetched successfully",
    result,
  );
});
