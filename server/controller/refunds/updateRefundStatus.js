const { asyncWrapper, sendSuccess } = require("../../utils");
const { updateRefundStatus } = require("../../service/refundServices");

exports.updateRefundStatus = asyncWrapper(async (req, res) => {
  const vendorId = req.payload._id;
  const { refundId } = req.params;
  const { action } = req.body;
  await updateRefundStatus(refundId, vendorId, action);
  return sendSuccess(res, 200, `Refund ${action.toLowerCase()} successfully`);
});
