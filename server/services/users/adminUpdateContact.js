const User = require("../../models/User");
const { throwError } = require("../../utils");
const { DUPLICATE_KEY } = require("../../constants/mongo");
const { ROLES } = require("../../constants");
const {
  NOTIFICATION_AUDIENCE,
  NOTIFICATION_TYPES,
  NOTIFICATION_SEVERITY,
} = require("../../constants/notification");
const { applyIdentityChange, IDENTITY_KEYS } = require("../../helpers/users");
const { notify, sendQuietly } = require("../../helpers/notifications");

/**
 * ---------------- the support desk's way out ----------------
 *
 * An admin changes somebody's `email`, `mobile` or `whatsappNumber` for them.
 *
 * ### ⚠️ Why this exists at all
 *
 * `whatsappNumber` cannot be changed by any ordinary path — it is the login
 * identity, and moving it requires an OTP on the number being left behind
 * (`POST /auth/whatsapp/verify`). That is right, and it leaves exactly one person
 * stranded: somebody whose old SIM is gone. They cannot prove the old number,
 * so they cannot change it, so they can never sign in again.
 *
 * This is the only door out, and it is deliberately narrow: an admin, a written
 * reason, an audit line, and a notice to the account.
 *
 * ### ⚠️ It changes the value. It does **not** verify it.
 *
 * Every key written here lands `false`. An admin typing a number is not evidence
 * that it belongs to that person — so:
 *
 * - `isWhatsappVerified: false` until the user signs in with it, and
 *   `verifyOtpWithWhatsapp` sets the flag as it always has. The OTP still
 *   happens; it just happens at the next login instead of before the change.
 * - an unverified `email` or `mobile` **cannot be signed in with** at all
 *   (`helpers/auth/assertIdentityVerified.js`), which is what stops this
 *   endpoint from being a way into somebody's account. An admin who set a
 *   customer's email to their own would still be refused at the login.
 *
 * So the rule the whole feature rests on survives intact: **no flag turns true
 * without an OTP, whoever does the writing.**
 */

/** Only these three, and only where a value was actually sent. */
const collectChanges = (payload) => {
  const changes = {};
  for (const key of Object.keys(IDENTITY_KEYS)) {
    if (payload[key] !== undefined && payload[key] !== null && payload[key] !== "") {
      changes[key] = payload[key];
    }
  }
  return changes;
};

exports.adminUpdateContact = async (actor, userId, payload = {}) => {
  const changes = collectChanges(payload);
  if (!Object.keys(changes).length) {
    throwError(422, "Send at least one of email, mobile or whatsappNumber to change.");
  }

  const user = await User.findById(userId);
  if (!user || user.isDeleted) throwError(404, "User not found");

  /**
   * ⚠️ The polite refusal; the partial unique indexes are the guard.
   *
   * Keyed on `{ field, role }` because the rest of the auth layer is — the same
   * person legitimately holds a CUSTOMER and a VENDOR account on one number.
   */
  for (const [field, value] of Object.entries(changes)) {
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
        `That ${field === "email" ? "email address" : "number"} is already in use on another ${user.role} account.`,
      );
    }
  }

  const before = Object.fromEntries(
    Object.keys(changes).map((key) => [key, user[key] ?? null]),
  );

  let result;
  try {
    result = await applyIdentityChange(user, changes, {
      verified: false,
      // The one caller allowed to move a WhatsApp number without an OTP — and
      // the flag still lands `false`, so the OTP only moves to the next login.
      allowWhatsapp: true,
    });
  } catch (error) {
    if (error?.code === DUPLICATE_KEY) {
      throwError(
        409,
        "That value was taken while you were saving. Try a different one.",
      );
    }
    throw error;
  }

  /**
   * ⚠️ Every other session dies when the **login identity** moves.
   *
   * The account now signs in with a number its current sessions were never
   * issued against. Leaving those tokens alive would let whoever holds one keep
   * using an account the owner has just been handed back.
   */
  const movedLogin = result.changed.includes("whatsappNumber");
  if (movedLogin) {
    user.sessionInvalidatedAt = new Date();
    await user.save();
  }

  /**
   * The audit.
   *
   * ⚠️ Values are **not** logged. "Who changed what field, when, and why" is what
   * an audit answers; printing a customer's phone number into the application log
   * spreads it somewhere with different retention and different access, for no
   * extra answer.
   */
  console.warn(
    `[identity] admin ${actor.userId} changed ${result.changed.join(", ")} ` +
      `on user ${user._id} (${user.role}) — reason: ${payload.reason}`,
  );

  /**
   * And tell the person. The in-app row is the part that cannot be lost: an admin
   * who has just moved the account's contact details is, by definition, changing
   * where outbound messages go, so the row is waiting whichever address works.
   *
   * ⚠️ `sendQuietly(() => ...)`, a thunk — not an already-invoked promise. The
   * wrapper calls what it is given inside its own try/catch, so passing
   * `notify(...)` would create the promise outside the guard and a delivery
   * failure would become an unhandled rejection.
   */
  await sendQuietly(
    () =>
      notify({
        userId: user._id,
        audience:
          user.role === ROLES.CUSTOMER
            ? NOTIFICATION_AUDIENCE.CUSTOMER
            : user.role === ROLES.ADMIN
              ? NOTIFICATION_AUDIENCE.ADMIN
              : NOTIFICATION_AUDIENCE.VENDOR,
        type: NOTIFICATION_TYPES.ACCOUNT_CONTACT_CHANGED,
        severity: NOTIFICATION_SEVERITY.WARNING,
        title: "Your contact details were changed",
        body:
          `An administrator updated your ${result.changed.join(" and ")}. ` +
          `If you did not ask for this, contact support straight away.`,
        meta: { changed: result.changed, byAdminId: actor.userId },
      }),
    "adminUpdateContact",
  );

  return {
    userId: user._id,
    role: user.role,
    changed: result.changed,
    // What each key was, so the admin's screen can show the before/after without
    // a second read. The **new** values are on the user they just looked at.
    previous: before,
    profileSynced: result.profileSynced,
    // Every one of these is now `false` — stated rather than implied, because it
    // is the whole reason this endpoint is not a way into the account.
    verified: Object.fromEntries(
      result.changed.map((key) => [IDENTITY_KEYS[key].flag, false]),
    ),
    sessionsEnded: movedLogin,
  };
};
