const { updateVoucherById } = require("../../service/voucherServices");
const { sendSuccess, sendError } = require("../../utils");

exports.updateVoucher = async (req, res) => {
  try {
    const { id } = req.params;
    const updatedBy = req.payload?._id;
    const brandUserId = req.brand?.user?._id;
    const updatePayload = req.body;

    const updatedVoucher = await updateVoucherById(
      id,
      updatePayload,
      updatedBy,
      brandUserId
    );
    return sendSuccess(
      res,
      200,
      "Voucher updated successfully",
      updatedVoucher
    );
  } catch (error) {
    console.error("Error updating voucher:", error);
    return sendError(
      res,
      error.statusCode || 500,
      error.message || "Failed to update voucher",
      error
    );
  }
};
