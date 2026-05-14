const { sendSuccess, asyncWrapper } = require("../../utils");
const {
  getClaimedVouchersByUser,
} = require("../../service/transactionServices");

exports.getAllClaimedTransactions = asyncWrapper(async (req, res) => {
  const tokenUserId = req.payload?._id;
  const userRole = req.payload?.role;
  const data = await getClaimedVouchersByUser(userRole, tokenUserId, req.query);
  return sendSuccess(res, 200, "Claimed vouchers fetched", data);
});
