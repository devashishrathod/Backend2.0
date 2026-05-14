const { getAllRefundRequests } = require("../../service/refundServices");
const { asyncWrapper, sendSuccess } = require("../../utils");

exports.getAllRefunds = asyncWrapper(async (req, res) => {
  const result = await getAllRefundRequests(req.query);
  return sendSuccess(res, 200, "Refunds fetched successfully", result);
});
