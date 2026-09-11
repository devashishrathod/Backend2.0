const User = require("../../models/User");
const { throwError } = require("../../utils");
const { LOGIN_TYPES } = require("../../constants");
const { DUPLICATE_KEY } = require("../../constants/mongo");
const {
  MOBILE_VERIFY_OTP_PURPOSE,
  WHATSAPP_VERIFY_OTP_PURPOSE,
  WHATSAPP_CHANGE_CURRENT_OTP_PURPOSE,
} = require("../../constants/otp");
const { sendOtp, verifyOtp } = require("../otps");
const { sendThrottledMobileOtp } = require("../../helpers/twoFactor");
const { verifyOtpToMobile } = require("../../helpers/twoFactor");
const {
  maskPhone,
  applyIdentityChange,
} = require("../../helpers/users");
const { normalisePhone } = require("../../validator/common");

/**
 * ---------------- confirming a phone number ----------------
 *
 * The same two calls as `emailVerification.js`, for the two phone keys. That file
 * is the template and the reasoning there applies here unchanged:
 *
 *  - **verify and change are one flow.** Splitting them would be two endpoints
 *    whose only difference is whether the value happens to match what is on file,
 *    and the client would have to decide which to call.
 *  - **the code goes to the value being claimed**, never the one on file. Sending
 *    it to the number already on the account proves they still hold the old
 *    number, which is not the question.
 *  - **`assertNotTaken` runs twice**, at send and again at verify. Minutes pass
 *    between the two calls and that is long enough for somebody else to take it.
 *  - **the value and the flag land in one write** (`applyIdentityChange`), so
 *    there is no instant where a changed key sits unverified with no way back.
 *  - **`loginType` is not touched.** The caller already holds a token; this is
 *    not a sign-in.
 *
 * ### ⚠️ Where this differs from email, and why
 *
 * **`whatsappNumber` is a step-up.** It is the login identity for every non-admin
 * role, so a code sent only to the *new* number would let anyone holding a stolen
 * session move the account onto their own phone — permanently, with no way back
 * for the real owner. Changing a **verified** WhatsApp number therefore asks for a
 * code on the **current** one first. Adding a number that was never verified stays
 * a single step, because there is nothing to step up from.
 *
 * **`mobile` is not.** It is a secondary key, usually absent, and the account is
 * still reachable by WhatsApp.
 *
 * **The two transports are not the same.** WhatsApp codes are ours — generated,
 * hashed and stored with a purpose, so a code issued for one flow cannot be
 * replayed into another. Mobile codes belong to 2factor: they hand back a
 * `sessionId` which the client echoes to `verify`. That is why the mobile calls
 * carry one and the WhatsApp calls do not.
 */

/** Which flag, purpose and sender each channel uses. */
const CHANNELS = Object.freeze({
  mobile: Object.freeze({
    field: "mobile",
    flag: "isMobileVerified",
    label: "mobile number",
    purpose: MOBILE_VERIFY_OTP_PURPOSE,
    stepUp: false,
  }),
  whatsappNumber: Object.freeze({
    field: "whatsappNumber",
    flag: "isWhatsappVerified",
    label: "WhatsApp number",
    purpose: WHATSAPP_VERIFY_OTP_PURPOSE,
    stepUp: true,
  }),
});

/** The account, or a 404 that does not distinguish "gone" from "never existed". */
const loadUser = async (userId) => {
  const user = await User.findById(userId);
  if (!user || user.isDeleted) throwError(404, "User not found");
  return user;
};

/**
 * Is this number already on somebody else's account **of the same role**?
 *
 * Role is part of the key because the rest of the auth layer treats it that way —
 * the same person legitimately holds a CUSTOMER and a VENDOR account on one
 * number, and `user_{field}_role_unique` is keyed on the pair.
 *
 * ⚠️ This is the polite refusal. The partial unique index is the guard: two
 * people can pass this read in the same instant and the index picks the winner.
 */
const assertNotTaken = async (user, field, value) => {
  const taken = await User.findOne({
    [field]: value,
    role: user.role,
    isDeleted: false,
    _id: { $ne: user._id },
  })
    .select("_id")
    .lean();

  if (taken) {
    throwError(
      409,
      "That number is already in use on another account. Try a different one.",
    );
  }
};

/** Send a code to a phone, by the transport that channel uses. */
const dispatch = async (channel, target, purpose) => {
  if (channel.field === "whatsappNumber") {
    await sendOtp(LOGIN_TYPES.WHATSAPP, target, purpose);
    return { sentTo: maskPhone(target) };
  }
  // 2factor owns the code; the client carries the session back to `verify`.
  const result = await sendThrottledMobileOtp(target, purpose);
  return { sentTo: maskPhone(target), sessionId: result?.Details || null };
};

/**
 * Step one — send the code.
 *
 * The number omitted confirms whatever is already on the account; a number
 * present starts a change, and nothing about the account moves until step two.
 */
const sendContactVerification = async (channelKey, actor, payload = {}) => {
  const channel = CHANNELS[channelKey];
  if (!channel) throwError(500, `Unknown verification channel: ${channelKey}`);

  const user = await loadUser(actor.userId);

  const current = normalisePhone(user[channel.field] || "");
  const target = normalisePhone(payload[channel.field] || "") || current;

  if (!target) {
    throwError(
      422,
      `There is no ${channel.label} on this account yet. Send the number you want to add.`,
    );
  }

  const isChange = target !== current;

  /**
   * Nothing to do, and saying so beats sending a code that changes nothing. A
   * client that wants to re-verify anyway can send the number explicitly — that
   * is a change of zero digits and falls to the same branch — so this only
   * catches the accidental case.
   */
  if (!isChange && user[channel.flag]) {
    throwError(409, `This ${channel.label} is already verified.`);
  }

  if (isChange) await assertNotTaken(user, channel.field, target);

  /**
   * ⚠️ The step-up: prove the **old** number before the new one is even sent a
   * code.
   *
   * Only when a verified number is being replaced. Adding a number that was never
   * confirmed has nothing to step up from, and demanding a code on it would be
   * asking the user to prove something the account never claimed.
   */
  if (channel.stepUp && isChange && user[channel.flag]) {
    await sendOtp(
      LOGIN_TYPES.WHATSAPP,
      current,
      WHATSAPP_CHANGE_CURRENT_OTP_PURPOSE,
    );
    return {
      step: "CONFIRM_CURRENT",
      sentTo: maskPhone(current),
      isChange: true,
    };
  }

  const sent = await dispatch(channel, target, channel.purpose);
  return { step: "CONFIRM_NEW", isChange, ...sent };
};

/**
 * Step two — present the code.
 *
 * For a step-up change this is called twice: first with the code from the old
 * number, which only unlocks the send to the new one, and then with the code from
 * the new number, which is the write.
 */
const verifyContact = async (channelKey, actor, payload = {}) => {
  const channel = CHANNELS[channelKey];
  if (!channel) throwError(500, `Unknown verification channel: ${channelKey}`);

  const user = await loadUser(actor.userId);

  const current = normalisePhone(user[channel.field] || "");
  const target = normalisePhone(payload[channel.field] || "") || current;

  if (!target) {
    throwError(
      422,
      `There is no ${channel.label} on this account yet. Send the number you are verifying.`,
    );
  }

  const isChange = target !== current;

  /**
   * The first leg of a step-up: the code presented belongs to the **old** number.
   * Consuming it does not change anything — it only earns the right to have a
   * code sent to the new number, which is what this returns.
   */
  if (channel.stepUp && isChange && user[channel.flag]) {
    const confirmed = await consumeCurrentNumberCode(current, payload.otp);
    if (confirmed) {
      await assertNotTaken(user, channel.field, target);
      const sent = await dispatch(channel, target, channel.purpose);
      return { step: "CONFIRM_NEW", isChange: true, wasChange: false, ...sent };
    }
  }

  if (channel.field === "whatsappNumber") {
    await verifyOtp(target, payload.otp, channel.purpose);
  } else {
    if (!payload.sessionId) {
      throwError(422, "Session ID is required");
    }
    const result = await verifyOtpToMobile(payload.sessionId, payload.otp);
    if (result?.Status !== "Success") throwError(401, "Invalid OTP");
  }

  /**
   * ⚠️ Checked **again**, after the code. Minutes pass between the two calls, and
   * that is long enough for somebody else to take the number — and the check is
   * cheap next to the round trip that just happened.
   */
  if (isChange) await assertNotTaken(user, channel.field, target);

  try {
    await applyIdentityChange(
      user,
      { [channel.field]: target },
      { verified: true, allowWhatsapp: channel.field === "whatsappNumber" },
    );
  } catch (error) {
    if (error?.code === DUPLICATE_KEY) {
      throwError(
        409,
        "That number was taken while you were verifying it. Try a different one.",
      );
    }
    throw error;
  }

  /**
   * ⚠️ Every other session dies when the **login identity** moves.
   *
   * If the change was made from a stolen session, the thief now holds a token for
   * an account whose sign-in number is theirs. Killing every token issued before
   * this instant is what lets the real owner — who still has the old number, and
   * whose code was required to get here — come back in.
   *
   * Not done for `mobile`: it is a secondary key and the account is still reachable
   * by WhatsApp, so the cost of signing everyone out buys nothing.
   */
  if (channel.field === "whatsappNumber" && isChange) {
    user.sessionInvalidatedAt = new Date();
    await user.save();
  }

  return {
    step: "DONE",
    [channel.field]: user[channel.field],
    [channel.flag]: true,
    wasChange: isChange,
    sessionsEnded: channel.field === "whatsappNumber" && isChange,
  };
};

/**
 * Was this the code we sent to the number already on file?
 *
 * Returns `false` rather than throwing when no such code is outstanding, because
 * that is the ordinary case: a single-step verification reaches this only if the
 * caller has no step-up in flight, and it should fall through to the normal path
 * rather than report an error about a code nobody asked for.
 */
const consumeCurrentNumberCode = async (current, otp) => {
  try {
    await verifyOtp(current, otp, WHATSAPP_CHANGE_CURRENT_OTP_PURPOSE);
    return true;
  } catch (error) {
    // A wrong or expired code on a step-up that *is* in flight must still be
    // reported — only "there is no such code" falls through.
    if (error?.statusCode === 401 && /expired or missing/i.test(error.message)) {
      return false;
    }
    throw error;
  }
};

exports.sendMobileVerification = (actor, payload) =>
  sendContactVerification("mobile", actor, payload);
exports.verifyMobile = (actor, payload) => verifyContact("mobile", actor, payload);
exports.sendWhatsappVerification = (actor, payload) =>
  sendContactVerification("whatsappNumber", actor, payload);
exports.verifyWhatsapp = (actor, payload) =>
  verifyContact("whatsappNumber", actor, payload);
