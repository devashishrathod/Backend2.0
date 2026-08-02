const { asyncWrapper, sendSuccess } = require("../../utils");
const { createSubscribeOrder } = require("../../services/transactions");

exports.subscribeCreateOrder = asyncWrapper(async (req, res) => {
  const result = await createSubscribeOrder(req.userId, req.validatedData);
  return sendSuccess(
    res,
    200,
    "Subscribe transaction order created successfully",
    result,
  );
});
