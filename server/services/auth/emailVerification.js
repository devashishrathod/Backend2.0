const User = require("../../models/User");
const { throwError } = require("../../utils");
const { LOGIN_TYPES } = require("../../constants");
const { EMAIL_VERIFY_OTP_PURPOSE } = require("../../constants/otp");
const { DUPLICATE_KEY } = require("../../constants/mongo");
const { sendOtp, verifyOtp } = require("../otps");
const { maskEmail } = require("../../helpers/users");

/**
 * ---------------- confirming an email address ----------------
 *
 * One flow, every role. A customer, a vendor, an outlet manager and an admin all
 * reach this the same way, which is why it sits on `verifyJwtToken` rather than
 * any role gate — `User.isEmailVerified` exists for all of them and was never
 * settable by any of them.
 *
 * ### Verify and change are the same two calls
 *
 * Splitting them would mean two endpoints whose only difference is whether the
 * address happens to match the one on file, and a client would have to decide
 * which to call. Worse, "change" without a verification step is what produced
 * the state this fixes: `isEmailVerified` flipping to `false` on every email
 * edit with no way back.
 *
 * ⚠️ **The code always goes to the address being claimed, never to the one on
 * file.** Sending it to the old address proves the person still reads the old
 * mailbox — which is not the question. The question is whether they own the new
 * one.
 */

/** Normalised, or `""`. Addresses are stored and compared lowercased. */
const normalise = (value) => String(value || "").trim().toLowerCase();

/**
 * The account, or a 404 that does not distinguish "gone" from "never existed".
 *
 * `isDeleted` is filtered in the query rather than checked after, for the reason
 * the login services give: a soft-deleted account should be indistinguishable
 * from one that was never there.
 */
const loadUser = async (userId) => {
  const user = await User.findById(userId);
  if (!user || user.isDeleted) throwError(404, "User not found");
  return user;
};

/**
 * Is this address already on somebody else's account **of the same role**?
 *
 * Role is part of the key because the rest of the codebase treats it that way —
 * `registerUser` and every login look users up by `{ email, role }`, so the same
 * address on a CUSTOMER and a VENDOR account is a supported state, not a
 * collision.
 *
 * ⚠️ **This is an application-level check, and there is no unique index behind
 * it.** `User` has unique indexes on `username`, `referralCode` and `uniqueId` —
 * not on email. So two people verifying the same address in the same few seconds
 * can both pass. The window is small and the damage is recoverable (two accounts
 * share an address; login by email then finds the older one), but it is real.
 *
 * The fix is a **partial** unique index on `{ email, role }` filtered to
 * `email: { $type: "string" }` — partial because `email` is optional on
 * OTP-created accounts, and a blanket unique on a nullable path rejects the
 * *second* account with no email at all. That is the `invoiceId_1` failure in
 * `CLAUDE.md`, exactly. It is not added here because creating it would fail on
 * any pre-existing duplicate, and that has to be checked against real data
 * first — see `scripts/ensureIndexes.js`.
 */
const assertNotTaken = async (user, email) => {
  const taken = await User.findOne({
    email,
    role: user.role,
    isDeleted: false,
    _id: { $ne: user._id },
  })
    .select("_id")
    .lean();

  if (taken) {
    throwError(
      409,
      "That email address is already in use on another account. Try a different one.",
    );
  }
};

/**
 * Step one — send the code.
 *
 * `email` omitted confirms whatever is already on the account. `email` present
 * starts a change, and nothing about the account moves until step two.
 */
exports.sendEmailVerification = async (actor, payload = {}) => {
  const user = await loadUser(actor.userId);

  const current = normalise(user.email);
  const target = normalise(payload.email) || current;

  if (!target) {
    throwError(
      422,
      "There is no email address on this account yet. Send the address you want to add.",
    );
  }

  const isChange = target !== current;

  /**
   * Nothing to do, and saying so is better than sending a code that changes
   * nothing. A client that wants to re-verify anyway can send the address
   * explicitly — that is a change of zero characters and falls to the same
   * branch, so this only catches the accidental case.
   */
  if (!isChange && user.isEmailVerified) {
    throwError(409, "This email address is already verified.");
  }

  if (isChange) await assertNotTaken(user, target);

  /**
   * The throttle lives inside `sendOtp` — 60 seconds between codes and five an
   * hour, keyed on the **target address** and this purpose, overridable from
   * `Setting.security.otp`. Putting it here instead would leave the next OTP
   * endpoint somebody adds unprotected, and forgetting a rate limit produces no
   * error at all: just an open endpoint that costs money per request.
   */
  await sendOtp(LOGIN_TYPES.EMAIL, target, EMAIL_VERIFY_OTP_PURPOSE);

  return {
    // Masked: this can be reached with a stolen session, and the full address
    // would be new information to whoever holds it.
    sentTo: maskEmail(target),
    isChange,
  };
};

/**
 * Step two — present the code.
 *
 * On success the address is written **and** marked verified in the same save, so
 * there is no instant where a changed address sits unverified and the user has
 * no way to fix it.
 */
exports.verifyEmail = async (actor, payload = {}) => {
  const user = await loadUser(actor.userId);

  const current = normalise(user.email);
  const target = normalise(payload.email) || current;

  if (!target) {
    throwError(
      422,
      "There is no email address on this account yet. Send the address you are verifying.",
    );
  }

  const isChange = target !== current;

  /**
   * Throws on a wrong, expired or over-attempted code, and consumes it on
   * success — so a code cannot be replayed to flip the address again later.
   */
  await verifyOtp(target, payload.otp, EMAIL_VERIFY_OTP_PURPOSE);

  /**
   * ⚠️ Checked **again**, after the code.
   *
   * Minutes pass between the two calls, and that is long enough for somebody
   * else to register the address in between. Checking only at send time would
   * hand this user a verified duplicate — and the check is cheap next to an
   * email round trip.
   */
  if (isChange) await assertNotTaken(user, target);

  user.email = target;
  user.isEmailVerified = true;

  /**
   * ⚠️ `loginType` is deliberately **not** touched.
   *
   * `verifyEmailOTP` sets it to `EMAIL` because that call *is* a sign-in. This
   * one is not — the caller already holds a token. Moving `loginType` here would
   * rewrite how a WhatsApp customer is recorded as having signed in, purely
   * because they confirmed an address.
   */
  try {
    await user.save();
  } catch (error) {
    /**
     * `user_email_role_unique` is the real guard; the check above is the polite
     * one.
     *
     * Two people can verify the same address in the same instant and both pass
     * `assertNotTaken` — it is a read, and reads do not reserve anything. The
     * index refuses the second write, and this turns that into the same 409 the
     * polite check would have given rather than a raw driver error surfacing as
     * a 422 about a field the customer never typed.
     */
    if (error?.code === DUPLICATE_KEY) {
      throwError(
        409,
        "That email address was taken while you were verifying it. Try a different one.",
      );
    }
    throw error;
  }

  return {
    email: user.email,
    isEmailVerified: true,
    wasChange: isChange,
  };
};
