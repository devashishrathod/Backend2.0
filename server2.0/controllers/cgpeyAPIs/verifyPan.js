const { asyncWrapper, sendSuccess } = require("../../utils");
const { verifyPanAndFetchDetails } = require("../../services/cgpeyAPIs");

exports.verifyPan = asyncWrapper(async (req, res) => {
  const result = await verifyPanAndFetchDetails(req.validatedData, req.brandId);
  return sendSuccess(res, 200, "PAN verified successfully", result);
});
