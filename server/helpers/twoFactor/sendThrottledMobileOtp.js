const OtpThrottle = require("../../models/OtpThrottle");
const { claimOtpSend } = require("../otps");
const { throwError } = require("../../utils");
const { sendOtpToMobile } = require("./sendOtpToMobile");

/**
 * ---------------- the SMS path had no rate limit at all ----------------
 *
 * `CLAUDE.md` states that every OTP path goes through `services/otps/sendOtp.js`,
 * where the throttle lives. Mobile never did: `sendOtp` refuses anything that is
 * not WhatsApp or email (`401 Invalid login type`), so `loginWithMobileOTP` called
 * 2factor directly and nothing counted the sends.
 *
 * `POST /auth/login-with-mobile` is public. Anyone could post a stranger's number
 * as fast as they liked and every request became an SMS **we pay for**, landing on
 * a phone belonging to someone who never asked for it. That is the exact hole the
 * WhatsApp and email paths were closed for, still open on the third one.
 *
 * ### Why this is a wrapper and not a move into `sendOtp`
 *
 * `sendOtp` owns the code: it generates one, hashes it with the target and a
 * purpose, and stores it. 2factor's `AUTOGEN` owns its own code and hands back a
 * `sessionId` instead — so mobile cannot go through `sendOtp` without changing the
 * transport, which would need a DLT-approved template and a sender ID.
 *
 * The throttle does not care about any of that. `claimOtpSend` counts **sends**,
 * in a rolling window keyed on the target and purpose — it never touches the code.
 * So the limit can be applied without touching the transport, and the client's
 * `sessionId` contract is unchanged.
 *
 * ⚠️ What this still does not give mobile, and deliberately: no attempt cap and no
 * purpose-binding on the code itself, because those live with whoever stores the
 * code, and 2factor does.
 *
 * @param {string} mobile   ten digits
 * @param {string} purpose  its own throttle bucket — a login must not burn the
 *                          allowance a verification needs
 */
const sendThrottledMobileOtp = async (mobile, purpose = "auth") => {
  /**
   * Claimed **before** the message goes, because the claim is what makes two
   * simultaneous taps produce one SMS instead of two. Same order as `sendOtp`.
   */
  const claim = await claimOtpSend(mobile, purpose);

  if (!claim.allowed) {
    /**
     * `429`, and it says how long. A caller told only "try again later" tries
     * again straight away, which is another refusal and another confused person.
     * Same wording and same `retryAfterSeconds` as the WhatsApp and email paths,
     * so a client branches on one shape everywhere.
     */
    throwError(
      429,
      claim.reason === "HOURLY_CAP"
        ? `Too many codes have been sent to this number in the last hour. ` +
            `Please try again in ${Math.ceil(claim.retryAfterSeconds / 60)} minute(s).`
        : `We have already sent you a code — please check your messages. ` +
            `You can ask for another in ${claim.retryAfterSeconds} second(s).`,
      { retryAfterSeconds: claim.retryAfterSeconds },
    );
  }

  try {
    return await sendOtpToMobile(mobile);
  } catch (error) {
    /**
     * ⚠️ Give the slot back when the send itself failed.
     *
     * Keeping it would mean a 2factor outage locks a customer out of signing in
     * for an hour over a problem entirely on our side — five attempts burned
     * without a single message ever leaving.
     *
     * ⚠️ Pulled **by value**, not by a time range. Releasing everything from the
     * last minute would hand back slots claimed by other callers in the same
     * second, which is the flood this exists to stop.
     */
    await OtpThrottle.updateOne(
      { target: mobile, purpose },
      { $pull: { sends: claim.at } },
    ).catch(() => {});

    throw error;
  }
};

module.exports = { sendThrottledMobileOtp };
