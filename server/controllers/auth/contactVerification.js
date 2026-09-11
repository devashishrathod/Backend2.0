const { asyncWrapper, sendSuccess } = require("../../utils");
const {
  sendMobileVerification,
  verifyMobile,
  sendWhatsappVerification,
  verifyWhatsapp,
} = require("../../services/auth");

/**
 * Confirming a phone number — the same two calls per channel that
 * `emailVerification.js` has for an address.
 *
 * The messages read differently per outcome on purpose. To the person holding the
 * phone, *"check your messages"*, *"check the new number"* and *"we sent a code to
 * the number you have now"* are three different instructions, and a single generic
 * line makes the WhatsApp step-up look like it failed.
 */

exports.sendMobileVerificationHandler = asyncWrapper(async (req, res) => {
  const result = await sendMobileVerification(req, req.validatedData);
  return sendSuccess(
    res,
    200,
    result.isChange
      ? `We have sent a code to ${result.sentTo}. Enter it to switch to this number.`
      : `We have sent a code to ${result.sentTo}.`,
    result,
  );
});

exports.verifyMobileHandler = asyncWrapper(async (req, res) => {
  const result = await verifyMobile(req, req.validatedData);
  return sendSuccess(
    res,
    200,
    result.wasChange ? "Mobile number updated and verified." : "Mobile number verified.",
    result,
  );
});

exports.sendWhatsappVerificationHandler = asyncWrapper(async (req, res) => {
  const result = await sendWhatsappVerification(req, req.validatedData);
  return sendSuccess(
    res,
    200,
    // `CONFIRM_CURRENT` is the step-up's first leg: the code went to the number
    // they already have, not the one they are moving to. Saying "check the new
    // number" here would send them to a phone that has nothing on it.
    result.step === "CONFIRM_CURRENT"
      ? `To change your WhatsApp number we first need to confirm the one you have now. We have sent a code to ${result.sentTo}.`
      : result.isChange
        ? `We have sent a code to ${result.sentTo}. Enter it to switch to this number.`
        : `We have sent a code to ${result.sentTo}.`,
    result,
  );
});

exports.verifyWhatsappHandler = asyncWrapper(async (req, res) => {
  const result = await verifyWhatsapp(req, req.validatedData);

  if (result.step === "CONFIRM_NEW") {
    return sendSuccess(
      res,
      200,
      `Thanks — that is confirmed. We have now sent a code to ${result.sentTo}. Enter it to finish the change.`,
      result,
    );
  }

  return sendSuccess(
    res,
    200,
    result.wasChange
      ? "WhatsApp number updated and verified. You have been signed out everywhere else."
      : "WhatsApp number verified.",
    result,
  );
});
