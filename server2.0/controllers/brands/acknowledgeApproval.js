const { asyncWrapper, sendSuccess } = require("../../utils");
const { acknowledgeBrandApproval } = require("../../services/systemVerify");

exports.acknowledgeApproval = asyncWrapper(async (req, res) => {
  const result = await acknowledgeBrandApproval(req.userId);
  return sendSuccess(
    res,
    200,
    "Welcome aboard! Redirecting you to your dashboard.",
    result,
  );
});
