const Refund = require("../../model/Refund");
const { REFUND_STATUS } = require("../../constants");
const { throwError } = require("../../utils");

exports.updateRefundStatus = async (refundId, vendorId, action) => {
  const refund = await Refund.findOne({ _id: refundId, isDeleted: false });
  if (!refund) throwError(404, "Refund request not found");
  if (refund.status === REFUND_STATUS.APPROVED && refund.isApproved) {
    throwError(400, `Refund already ${refund.status.toLowerCase()}`);
  }
  if (action === REFUND_STATUS.APPROVED) {
    refund.status = REFUND_STATUS.APPROVED;
    refund.isApproved = true;
    refund.actionBy = vendorId;
    refund.actionAt = new Date();
  } else if (action === REFUND_STATUS.REJECTED) {
    refund.status = REFUND_STATUS.REJECTED;
    refund.isApproved = false;
    refund.actionBy = vendorId;
    refund.actionAt = new Date();
  } else {
    throwError(400, "Invalid action, must be APPROVE or REJECT");
  }
  await refund.save();
};
