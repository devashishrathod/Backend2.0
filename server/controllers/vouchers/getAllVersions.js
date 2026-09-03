const { asyncWrapper, sendSuccess } = require("../../utils");
const { getAllVoucherVersions } = require("../../services/vouchers");

exports.getAllVersions = asyncWrapper(async (req, res) => {
  const result = await getAllVoucherVersions(req.validatedData);
  return sendSuccess(res, 200, "Voucher versions fetched successfully", result);
});
