/**
 * Why an *authenticated* request was refused.
 *
 * The message on its own is not enough for a client. "Deactivated" has to force
 * a logout and land the user on a support screen, while an expired token has to
 * trigger a silent re-login — both arrive as a 401 with prose. So the auth gate
 * also sends `details.code`, and the app branches on that. Copy can then be
 * reworded, or translated, without breaking any client.
 *
 * **Everything here is a `401`, deliberately.** A `403` reads as "you are signed
 * in but not allowed this", which is why app interceptors keep the user inside
 * the app on one. A deactivated account has to be signed *out*, and every mobile
 * HTTP layer already does that on a `401` — so using it is what makes the logout
 * automatic instead of something each client has to remember to implement.
 *
 * Shape on the wire (see utils/response.js):
 *
 *   { "success": false,
 *     "message": "Your account is deactivated. Please contact support.",
 *     "details": { "code": "ACCOUNT_DEACTIVATED" } }
 */
const ACCOUNT_ACCESS_CODES = Object.freeze({
  // The caller's own User row is switched off by an admin.
  ACCOUNT_DEACTIVATED: "ACCOUNT_DEACTIVATED",
  // The token predates `User.sessionInvalidatedAt` — every session opened
  // before that instant was deliberately ended. Stamped on reactivation, so a
  // suspension can never be ridden out on a token minted before it.
  SESSION_INVALIDATED: "SESSION_INVALIDATED",
});

const ACCOUNT_ACCESS_MESSAGES = Object.freeze({
  ACCOUNT_DEACTIVATED: "Your account is deactivated. Please contact support.",
  SESSION_INVALIDATED: "Your session has ended. Please log in again.",
});

module.exports = {
  ACCOUNT_ACCESS_CODES,
  ACCOUNT_ACCESS_MESSAGES,
};
