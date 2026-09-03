const { asyncWrapper, sendSuccess } = require("../../utils");
const { resetPassword } = require("../../services/auth");

exports.resetPasswordHandler = asyncWrapper(async (req, res) => {
  const result = await resetPassword(req.validatedData);
  return sendSuccess(res, 200, result.message, result);
});
