const { asyncWrapper, sendSuccess } = require("../../utils");
const { verifyGstAndFetchDetails } = require("../../services/cgpeyAPIs");

exports.verifyGst = asyncWrapper(async (req, res) => {
  const result = await verifyGstAndFetchDetails(req.validatedData);
  return sendSuccess(res, 200, "GST verified successfully", result);
});
