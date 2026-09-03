const { asyncWrapper, sendSuccess } = require("../../utils");
const { getBrandVerificationHistory } = require("../../services/systemVerify");

exports.getVerificationHistory = asyncWrapper(async (req, res) => {
  const result = await getBrandVerificationHistory(req.query, {
    role: req.role,
    brandId: req.brandId,
  });
  return sendSuccess(
    res,
    200,
    "Brand verification history fetched successfully.",
    result,
  );
});
