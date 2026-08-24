const { asyncWrapper, sendSuccess } = require("../../utils");
const { setPassword } = require("../../services/auth");

exports.setPasswordHandler = asyncWrapper(async (req, res) => {
  const result = await setPassword(req.userId, req.validatedData);
  return sendSuccess(
    res,
    200,
    result.wasFirstTime
      ? "Password set successfully. You can now sign in with it."
      : "Password changed successfully.",
    result,
  );
});
