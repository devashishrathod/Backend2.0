const { normalisePhone } = require("../../validator/common");
const { throwError } = require("../../utils");
const { findRoleProfile, profileForRole } = require("./roleProfiles");

/**
 * ---------------- one place that writes an identity key ----------------
 *
 * `email`, `mobile` and `whatsappNumber` live on `User` **and** are mirrored onto
 * that user's role profile — `Customer`, `Brand` or `SubBrand`. Two copies, one
 * truth. This is the only function allowed to move either of them.
 *
 * ### Why the mirror has to be maintained, and not just tidied up
 *
 * The mirror is not decoration: five places read the **profile's** copy in
 * preference to the account's, and one of them decides where money goes.
 *
 * - `services/customerBankAccounts/sendBankOtp.js` sends the code that gates
 *   attaching a bank account to `Customer.whatsappNumber`. Until now that field
 *   was written once at signup and never again — so a customer who changed their
 *   number had the code delivered to the **old** one, and whoever holds that
 *   number today could point a pending refund at their own account.
 * - `helpers/notifications/notify.js` resolves a recipient as
 *   `customer?.email || brand?.email || user?.email` — the profile first.
 * - Invoices (`buildBillingDetails`, `buildVoucherInvoiceSnapshot`) and the
 *   vendor approval mail (`verifyVendor`) all read the profile's copy.
 *
 * ### The rule this enforces
 *
 * > A key's verified flag turns **`true` only through an OTP**. Every other write
 * > — a profile edit, a vendor correcting an outlet's email, an admin fixing a
 * > contact — sets it to `false`. Whoever does it.
 *
 * So callers do not set the flags themselves; they say whether this write was
 * backed by a one-time code, and the flag follows.
 *
 * ### `whatsappNumber` is not writable here by default
 *
 * It is the login identity for every non-admin role, so it may only move through
 * a verification flow (`allowWhatsapp: true`) or the audited admin contact
 * endpoint. A plain profile edit that tries to change it is refused rather than
 * silently ignored — ignoring it would let a vendor believe they had changed an
 * outlet's number when nothing happened.
 *
 * @param {object}  user                  a User **document** (not lean — this saves it)
 * @param {object}  changes               any of { email, mobile, whatsappNumber }
 * @param {object}  [options]
 * @param {boolean} [options.verified=false]      was this write backed by an OTP
 * @param {boolean} [options.allowWhatsapp=false] may this write move whatsappNumber
 * @param {object}  [options.session]             mongoose session, inside a transaction
 * @param {object}  [options.profile]             an already-loaded role profile
 * @returns {Promise<{changed: string[], profileSynced: boolean}>}
 */

/** The three keys, and what each one's confirmation is called. */
const IDENTITY_KEYS = Object.freeze({
  email: Object.freeze({
    flag: "isEmailVerified",
    channel: "email",
    normalise: (v) => String(v ?? "").trim().toLowerCase(),
  }),
  mobile: Object.freeze({
    flag: "isMobileVerified",
    channel: null, // there is no "notify me by SMS" preference
    normalise: normalisePhone,
  }),
  whatsappNumber: Object.freeze({
    flag: "isWhatsappVerified",
    channel: "whatsapp",
    normalise: normalisePhone,
  }),
});

const applyIdentityChange = async (
  user,
  changes = {},
  { verified = false, allowWhatsapp = false, session, profile } = {},
) => {
  if (!user) throwError(500, "applyIdentityChange was given no user");

  const changed = [];

  for (const [key, spec] of Object.entries(IDENTITY_KEYS)) {
    const incoming = changes[key];
    if (incoming === undefined || incoming === null) continue;

    const next = spec.normalise(incoming);
    // `|| ""` so an absent field and an empty one compare the same way; without
    // it, adding a first email would read as `undefined !== "a@b.com"` and adding
    // a value that is already there as `"a@b.com" !== "a@b.com"` — the first is
    // right by luck, the second is the one that matters.
    const current = spec.normalise(user[key] || "");
    if (next === current) continue;

    if (key === "whatsappNumber" && !allowWhatsapp) {
      throwError(
        422,
        "A WhatsApp number can only be changed by verifying it. " +
          "Start the change from the WhatsApp verification flow.",
        { code: "WHATSAPP_REQUIRES_VERIFICATION" },
      );
    }

    user[key] = next;
    user[spec.flag] = verified;
    changed.push(key);

    /**
     * ⚠️ An unverified key switches its notification channel off, and only the
     * person switching it back on can turn it on again.
     *
     * The guard in `helpers/notifications/channelPreferences.js` already refuses
     * to deliver on an unverified channel, so leaving the preference `true` would
     * not send anything wrong. It would do something subtler: the moment they
     * verified, email would resume **without them asking for it**, because a
     * `true` from before the change was still sitting there.
     *
     * Verifying proves *"this address is mine"*. It does not say *"send things
     * here"*. Those are two decisions and the second one is the toggle's.
     *
     * ⚠️ Only on the way down. A verified write deliberately leaves the
     * preference alone — turning it on for someone who had switched it off would
     * be the same mistake in the other direction.
     */
    if (!verified && spec.channel) {
      const prefs = user.notificationPreferences || {};
      if (prefs[spec.channel] !== false) {
        prefs[spec.channel] = false;
        prefs.updatedAt = new Date();
        user.notificationPreferences = prefs;
      }
    }
  }

  if (!changed.length) {
    // Nothing moved on the account — but the mirror may still be stale from
    // before any of this existed, so it is still worth a look.
    const profileSynced = await syncRoleProfileIdentity(user, { session, profile });
    return { changed: [], profileSynced };
  }

  await user.save({ session });

  const profileSynced = await syncRoleProfileIdentity(user, { session, profile });
  return { changed, profileSynced };
};

/**
 * Copy the account's three identity keys onto its role profile.
 *
 * Separate from `applyIdentityChange` because the repair is needed on paths where
 * **no value changes at all** — every WhatsApp sign-in, and the sync script. Left
 * inside the change path it would never run for them: that function returns early
 * when nothing moved, which is exactly the case a drifted mirror presents.
 *
 * ### ⚠️ All three keys, not only the ones that just changed
 *
 * Copying only what moved would preserve whatever drift is already there: an
 * account whose mirror went stale before this existed would get its email
 * corrected on an email change and keep a years-old phone number for ever,
 * because nothing would ever touch that key again.
 *
 * Writing all three makes every identity write a repair as well, so drift heals
 * the first time anybody touches the account — which is what lets
 * `scripts/syncRoleProfileIdentity.js` be a one-off catch-up rather than
 * something that has to keep running.
 *
 * ### ⚠️ A missing profile warns and does not throw
 *
 * This runs after the work that mattered — an OTP consumed, an address confirmed
 * — so failing it because a half-created account has no `Customer` row would undo
 * something real to protect something derived. `repairRoleProfile` rebuilds the
 * profile on the next login and the sync script fills the values in; the state is
 * recoverable, a rejected verification is not.
 *
 * Idempotent, and writes nothing when the two already agree.
 *
 * @returns {Promise<boolean>}  whether a profile was found and is now in step
 */
const syncRoleProfileIdentity = async (
  user,
  { session, profile: loaded } = {},
) => {
  if (!user?._id) return false;
  // ADMIN has no profile and never will — not worth a lookup or a log line.
  if (!profileForRole(user.role)) return false;

  /**
   * ⚠️ A caller that already holds the profile must pass it in.
   *
   * `updateBrand` loads the brand, edits other fields on it and saves it at the
   * end of its transaction. Looking it up again here would put **two documents
   * for one row** in flight: this one writes the contact keys, that one then
   * saves — and while Mongoose only sends the paths each document considers
   * dirty, so they do not overwrite each other today, it is one refactor away
   * from doing exactly that.
   */
  const profile = loaded || (await findRoleProfile(user, { session }));
  if (!profile) {
    console.warn(
      `[identity] no ${user.role} profile for user ${user._id} — ` +
        `account updated, mirror skipped`,
    );
    return false;
  }

  let drifted = false;
  for (const key of Object.keys(IDENTITY_KEYS)) {
    if (user[key] === undefined) continue;
    if (profile[key] === user[key]) continue;
    profile[key] = user[key];
    drifted = true;
  }

  if (drifted) await profile.save({ session });
  return true;
};

module.exports = {
  applyIdentityChange,
  syncRoleProfileIdentity,
  IDENTITY_KEYS,
};
