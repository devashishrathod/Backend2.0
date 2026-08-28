const { throwError } = require("../../utils");
const {
  ACCOUNT_ACCESS_CODES,
  ACCOUNT_ACCESS_MESSAGES,
} = require("../../constants/accountAccess");

/**
 * The single "may this account act at all?" gate.
 *
 * Called from every auth middleware and from every login path, so a deactivated
 * account is refused on the *next request* rather than only at the next login.
 * Before this existed, a vendor holding a valid token kept full access for the
 * whole life of that token after being deactivated — the login check was the
 * only one, and a logged-in vendor never passes through it again.
 *
 * Two independent refusals, both `401` so the client's own interceptor signs the
 * user out (see constants/accountAccess.js for why not `403`):
 *
 *  1. **The account is off** — `isActive: false`, any role. Skippable, see below.
 *  2. **The session was ended** — the token was minted before
 *     `user.sessionInvalidatedAt`. Never skippable: this is the primitive that
 *     backs "sign out everywhere", so a token it has killed must be dead
 *     everywhere, no exceptions.
 *
 * `allowDeactivated` is for the handful of endpoints a deactivated user still
 * has to reach — signing out, retiring their push devices, and reading the
 * notification that explains the suspension. It relaxes (1) only.
 *
 * ### What this deliberately does *not* check
 *
 * `Brand.isActive` is **not** consulted. It means "hidden from the customer
 * app", which is a separate switch from "the vendor may not sign in": a
 * suspended vendor's existing brand page, showcase and vouchers stay live for
 * customers who already have them. Locking the vendor out of their own panel
 * because their brand was de-listed would conflate two unrelated decisions.
 *
 * `SUB_VENDOR` accounts are only subject to their own `isActive`. Outlet staff
 * are managed one by one; suspending a brand owner does not sack the staff.
 *
 * Pure function — no database access, so it is free to run on every request.
 *
 * @param {object}  user                 User document or lean object
 * @param {object}  [options]
 * @param {number}  [options.issuedAt]    JWT `iat`, in seconds. Omit on login
 *                                        paths, where no token exists yet.
 * @param {boolean} [options.allowDeactivated=false]
 */
exports.assertAccountAccess = (user, options = {}) => {
  if (!user) return;

  const { issuedAt, allowDeactivated = false } = options;

  // Checked first, and never skipped: a killed session is killed for every
  // endpoint, including the deactivation-aware ones.
  if (issuedAt && user.sessionInvalidatedAt) {
    // Compared at second granularity because `iat` is seconds while the stamp
    // is milliseconds. Truncating the stamp instead of padding the token means
    // a token minted in the same second as the stamp survives — erring towards
    // keeping a legitimate session rather than opening a window.
    const invalidatedAtSeconds = Math.floor(
      new Date(user.sessionInvalidatedAt).getTime() / 1000,
    );
    if (issuedAt < invalidatedAtSeconds) {
      throwError(401, ACCOUNT_ACCESS_MESSAGES.SESSION_INVALIDATED, {
        code: ACCOUNT_ACCESS_CODES.SESSION_INVALIDATED,
      });
    }
  }

  if (allowDeactivated) return;

  // `isDeleted` is projected away by getUserById (and its query already filters
  // on it), so this reads as undefined there rather than false — hence `=== true`
  // instead of a truthiness check on a field that is normally absent.
  if (user.isActive === false || user.isDeleted === true) {
    throwError(401, ACCOUNT_ACCESS_MESSAGES.ACCOUNT_DEACTIVATED, {
      code: ACCOUNT_ACCESS_CODES.ACCOUNT_DEACTIVATED,
    });
  }
};
