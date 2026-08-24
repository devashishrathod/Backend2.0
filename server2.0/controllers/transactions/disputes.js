const { asyncWrapper, sendSuccess } = require("../../utils");
const { getDisputes } = require("../../services/transactions");

exports.disputeList = asyncWrapper(async (req, res) => {
  const result = await getDisputes(req.validatedData);
  return sendSuccess(res, 200, "Disputes fetched successfully", result);
});
