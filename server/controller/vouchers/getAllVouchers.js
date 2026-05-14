const { getVouchers } = require("../../service/voucherServices");
const { sendSuccess, asyncWrapper } = require("../../utils");

exports.getAllVouchers = asyncWrapper(async (req, res) => {
  const userId = req.payload?._id;
  const result = await getVouchers(userId, req.query);
  return sendSuccess(res, 200, "Vouchers fetched successfully", result);
});
