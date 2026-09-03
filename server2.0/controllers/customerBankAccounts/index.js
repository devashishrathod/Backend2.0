const { asyncWrapper, sendSuccess } = require("../../utils");
const {
  sendBankOtp,
  addBankAccount,
  getBankAccounts,
  removeBankAccount,
} = require("../../services/customerBankAccounts");

exports.requestBankOtp = asyncWrapper(async (req, res) => {
  const result = await sendBankOtp(req);
  return sendSuccess(res, 200, "We have sent you a code.", result);
});

exports.addCustomerBankAccount = asyncWrapper(async (req, res) => {
  const result = await addBankAccount(req, req.body);
  return sendSuccess(res, 201, "Bank account verified and added.", result);
});

exports.listCustomerBankAccounts = asyncWrapper(async (req, res) => {
  const result = await getBankAccounts(req);
  return sendSuccess(res, 200, "Bank accounts fetched successfully.", result);
});

exports.deleteCustomerBankAccount = asyncWrapper(async (req, res) => {
  const result = await removeBankAccount(req, req.params.accountId);
  return sendSuccess(res, 200, "Bank account removed.", result);
});
