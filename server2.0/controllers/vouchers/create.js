const { asyncWrapper, sendSuccess } = require("../../utils");
const { createVoucher } = require("../../services/vouchers");

exports.create = asyncWrapper(async (req, res) => {
  const result = await createVoucher(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    req.validatedData,
    req.files,
  );
  return sendSuccess(res, 201, "Voucher created successfully.", result);
});
