const { saveOtp } = require("../../database/otpRepository");
const { sendTemplate, claimOtpSend } = require("../../helpers/otps");
const { sendLoginOtpMail } = require("../../helpers/nodeMailer");
const { LOGIN_TYPES } = require("../../constants");
const { generateNumericOtp, hashOtp, throwError } = require("../../utils");
const OtpThrottle = require("../../models/OtpThrottle");

/**
 * Send a one-time code, and refuse to flood.
 *
 * ### ⚠️ The limit lives here, not on the routes
 *
 * Every OTP path in the repo goes through this function — login by WhatsApp,
 * login by email, forgot-password, sub-brand signup, and attaching a bank
 * account for a refund. Putting the check here means a route added next month is
 * covered without anybody remembering to cover it, and forgetting a rate-limit
 * middleware produces **no error at all** — just an endpoint nobody is
 * protecting.
 *
 * Before this there was no limit anywhere: anyone could post a stranger's number
 * to a public login route as fast as they liked, and each request became a
 * WhatsApp message or an SMS **we pay for**, landing on a phone belonging to
 * someone who never asked for it.
 *
 * The numbers come from `Setting.security.otp`, falling back to
 * `constants/otp.js` — 60 seconds between codes, 5 an hour, per target.
 */
exports.sendOtp = async (type, target, purpose = "auth") => {
  if (type !== LOGIN_TYPES.WHATSAPP && type !== LOGIN_TYPES.EMAIL) {
    throwError(401, "Invalid login type");
  }

  /**
   * Claimed **before** the message goes, because the claim is what makes two
   * simultaneous taps produce one message instead of two.
   */
  const claim = await claimOtpSend(target, purpose);

  if (!claim.allowed) {
    /**
     * `429`, and it says how long — a caller told only "try again later" tries
     * again straight away, which is another refusal and another confused person.
     *
     * The wording assumes the code arrived, because it almost always did: the
     * common case here is somebody tapping resend while the first message is in
     * flight, not an attack.
     */
    throwError(
      429,
      claim.reason === "HOURLY_CAP"
        ? `Too many codes have been sent to this number or email in the last hour. ` +
            `Please try again in ${Math.ceil(claim.retryAfterSeconds / 60)} minute(s).`
        : `We have already sent you a code — please check your messages. ` +
            `You can ask for another in ${claim.retryAfterSeconds} second(s).`,
      { retryAfterSeconds: claim.retryAfterSeconds },
    );
  }

  const otp = generateNumericOtp();
  const hash = hashOtp(otp, target, purpose);

  try {
    await saveOtp(type, target, purpose, hash);

    if (type === LOGIN_TYPES.WHATSAPP) {
      await sendTemplate(target, otp, otp);
    } else {
      await sendLoginOtpMail(target, otp);
    }
  } catch (error) {
    /**
     * ⚠️ Give the slot back when the send itself failed.
     *
     * Keeping it would mean a provider outage — a WhatsApp template pulled, a
     * mail server refusing — locks a customer out of logging in for an hour over
     * a problem entirely on our side. They would have burned five attempts
     * without a single message ever being sent.
     *
     * ⚠️ Pulled **by value**, not by a time range. Releasing everything from the
     * last minute would hand back slots claimed by other callers in the same
     * second — which is exactly the flood this is meant to stop.
     */
    await OtpThrottle.updateOne(
      { target, purpose },
      { $pull: { sends: claim.at } },
    ).catch(() => {});

    throw error;
  }

  return { success: true, message: "OTP sent" };
};
