const { asyncWrapper, sendSuccess } = require("../../utils");
const { createSubscribeOrder } = require("../../services/transactions");

exports.subscribeCreateOrder = asyncWrapper(async (req, res) => {
  const result = await createSubscribeOrder(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    req.validatedData,
  );
  return sendSuccess(
    res,
    200,
    "Subscribe transaction order created successfully",
    result,
  );
});
