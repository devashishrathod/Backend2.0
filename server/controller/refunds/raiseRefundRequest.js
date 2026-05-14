const { asyncWrapper, sendSuccess } = require("../../utils");
const { createRefundRequest } = require("../../service/refundServices");

exports.raiseRefundRequest = asyncWrapper(async (req, res) => {
  const userId = req.payload?._id;
  const refund = await createRefundRequest(userId, req.body);
  return sendSuccess(res, 201, "Refund request submitted successfully", refund);
});
