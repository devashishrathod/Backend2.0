const Bank = require("../../models/Bank");
const cgpeyClient = require("../../configs/cgpey");
const { fetchAPI } = require("../../helpers/cgpeyAPIs");
const { throwError } = require("../../utils");

exports.verifyBankAndFetchDetails = async (payload) => {
  const { accountNumber } = payload;
  const existing = await Bank.findOne({ accountNumber, isDeleted: false });
  if (existing) throwError(400, "This acoount number is already in use");
  return await fetchAPI(process.env.CGPEY_BANK_ENDPOINT, payload);
};
