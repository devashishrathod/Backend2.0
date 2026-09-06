const { asyncWrapper, sendSuccess } = require("../../utils");
const { sendEmailVerification, verifyEmail } = require("../../services/auth");

exports.sendEmailVerificationHandler = asyncWrapper(async (req, res) => {
  const result = await sendEmailVerification(req, req.validatedData);
  return sendSuccess(
    res,
    200,
    // The two cases read differently to the person holding the phone: one is
    // "check your inbox", the other is "check the new inbox".
    result.isChange
      ? `We have sent a code to ${result.sentTo}. Enter it to switch to this address.`
      : `We have sent a code to ${result.sentTo}.`,
    result,
  );
});

exports.verifyEmailHandler = asyncWrapper(async (req, res) => {
  const result = await verifyEmail(req, req.validatedData);
  return sendSuccess(
    res,
    200,
    result.wasChange
      ? "Email address updated and verified."
      : "Email address verified.",
    result,
  );
});
