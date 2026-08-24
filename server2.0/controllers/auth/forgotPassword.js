const { asyncWrapper, sendSuccess } = require("../../utils");
const { forgotPassword } = require("../../services/auth");

exports.forgotPasswordHandler = asyncWrapper(async (req, res) => {
  const result = await forgotPassword(req.validatedData);
  // Same response whether or not the account exists — otherwise this endpoint
  // becomes a way to enumerate registered numbers and emails.
  return sendSuccess(res, 200, result.message, result);
});
