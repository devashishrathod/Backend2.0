const { asyncWrapper, sendSuccess } = require("../../utils");
const { createBank } = require("../../services/bank");

exports.addBankDetails = asyncWrapper(async (req, res) => {
  const result = await createBank(req.userId, req.validatedData);
  return sendSuccess(res, 200, "Bank details added successfully.", result);
});
