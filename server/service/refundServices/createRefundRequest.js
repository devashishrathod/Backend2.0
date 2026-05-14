const Refund = require("../../model/Refund");
const Transaction = require("../../model/Transaction");
const BankAccount = require("../../model/BankAccount");
const Voucher = require("../../model/Voucher");
const { getBankByAccountNumber } = require("../bankAccountServices");
const { generateUniqueRefundId } = require("./generateUniqueRefundId");
const { BANK_ACCOUNT_TYPES, REFUND_STATUS } = require("../../constants");
const { throwError } = require("../../utils");
const { isSameDay } = require("../../helpers/transactions");
const { isValidAccountNumber } = require("../../validator/common");

exports.createRefundRequest = async (userId, data) => {
  let {
    transactionId,
    voucherId,
    refundAmount,
    reason,
    bankName,
    branchName,
    accountNumber,
    ifscCode,
  } = data;
  const txn = await Transaction.findOne({
    _id: transactionId,
    user: userId,
    isDeleted: false,
  });
  if (!txn) throwError(404, "Invalid or fake transaction");
  const existingRefund = await Refund.findOne({
    transaction: txn._id,
    isDeleted: false,
  });
  if (existingRefund) {
    throwError(400, "Refund request already raised for this transaction");
  }
  if (!isSameDay(new Date(), txn.createdAt)) {
    throwError(
      400,
      "Refund can only be requested on the same day of transaction"
    );
  }
  if (refundAmount > txn.paidAmount) {
    throwError(400, "Refund amount cannot exceed paid amount");
  }
  voucherId = voucherId || txn.voucher;
  const voucherDoc = await Voucher.findOne({
    _id: voucherId,
    isDeleted: false,
  });
  if (!voucherDoc) throwError(404, "Invalid or mismatched voucher details");
  let bankAccount;
  const isValidAccount = isValidAccountNumber(accountNumber);
  if (!isValidAccount) throwError(422, "Invalid account number");
  const existingByAccount = await getBankByAccountNumber(accountNumber);
  if (existingByAccount) {
    if (existingByAccount.user.toString() !== userId.toString()) {
      throwError(409, "Account number already exists with another user.");
    }
    bankAccount = existingByAccount;
  } else {
    bankAccount = await BankAccount.create({
      user: userId,
      bankName,
      branchName,
      accountNumber,
      ifscCode,
      accountType: BANK_ACCOUNT_TYPES.SAVINGS,
    });
  }
  const result = await Refund.create({
    user: userId,
    brand: txn?.brand,
    subBrand: txn?.subBrand,
    voucher: voucherId,
    transaction: txn._id,
    bankAccount: bankAccount?._id,
    refundAmount,
    reason,
    status: REFUND_STATUS.SUBMITTED,
    uniqueId: await generateUniqueRefundId(),
    isApproved: false,
  });
  txn.refund = result?._id;
  txn.isRefundRequested = true;
  await txn.save();
  return result;
};
