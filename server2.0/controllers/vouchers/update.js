const { asyncWrapper, sendSuccess } = require("../../utils");
const { updateVoucher } = require("../../services/vouchers");

exports.update = asyncWrapper(async (req, res) => {
  const result = await updateVoucher(
    req.userId,
    req.validatedData,
    req.files?.newImages,
  );
  return sendSuccess(res, 200, "Voucher updated successfully.", result);
});
