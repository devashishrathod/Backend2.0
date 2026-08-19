const { asyncWrapper, sendSuccess } = require("../../utils");
const { createVoucher } = require("../../services/vouchers");

exports.create = asyncWrapper(async (req, res) => {
  const result = await createVoucher(
    req.userId,
    req.validatedData,
    req.files?.images,
  );
  return sendSuccess(res, 201, "Voucher created successfully.", result);
});
