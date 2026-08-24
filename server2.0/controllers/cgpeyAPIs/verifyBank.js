const { asyncWrapper, sendSuccess } = require("../../utils");
const { verifyBankAndFetchDetails } = require("../../services/cgpeyAPIs");

exports.verifyBank = asyncWrapper(async (req, res) => {
  const result = await verifyBankAndFetchDetails(
    req.validatedData,
    req.brandId,
  );
  return sendSuccess(res, 200, "Bank verified successfully", result);
});
