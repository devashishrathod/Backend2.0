const User = require("../../models/User");

/**
 * The two display flags every sign-in and sign-out has to move.
 *
 * `isLoggedIn` and `isOnline` are read by the admin customer directory — there
 * is a `?isLoggedIn=` filter on it — and by the customer detail screen. They
 * were being set by three of the seven paths that mint a token, and by none of
 * the paths that end a session:
 *
 *   set true by   registerUser · verifyEmailOTP · verifyMobileOTP
 *   never set by  verifyOtpWithWhatsapp  <- the main customer and vendor login
 *                 loginWithEmailAndPassword · loginWithMobileAndPassword
 *                 loginWithUsernameAndPassword
 *   set false by  only toggleBrandStatus, when an admin suspends a brand
 *
 * So the admin filter was wrong in both directions: nobody who signed in with
 * WhatsApp ever showed as logged in, and nobody who signed out ever stopped
 * showing as logged in. Nothing errored — a filter that quietly returns the
 * wrong rows looks exactly like a filter that works.
 *
 * This exists as one helper rather than four more copies because the failure is
 * silent and additive: the eighth login path added next year would be missed
 * the same way, and nothing would say so.
 *
 * ⚠️ **These can never be completely truthful.** A JWT is stateless: a customer
 * who closes the app, loses their phone or uninstalls never signs out, and their
 * token stays valid until it expires. Read `isLoggedIn` as "signed in and has
 * not signed out", not as "is using the app right now".
 */

/** Called wherever a token is minted. */
exports.markSignedIn = (userId) =>
  User.findByIdAndUpdate(userId, {
    $set: { isLoggedIn: true, isOnline: true },
  });

/**
 * Called on logout.
 *
 * `endSessions` stamps `sessionInvalidatedAt`, which kills every JWT issued
 * before now — the primitive behind "sign out of all devices". It is one write
 * with the flags rather than a second call, so a caller cannot end up having
 * flipped the flags and failed to kill the sessions: the request the customer
 * made was "sign me out everywhere", and half of that is worse than none.
 *
 * @param {string|ObjectId} userId
 * @param {object}  [options]
 * @param {boolean} [options.endSessions=false]
 */
exports.markSignedOut = (userId, { endSessions = false } = {}) =>
  User.findByIdAndUpdate(userId, {
    $set: {
      isLoggedIn: false,
      isOnline: false,
      ...(endSessions ? { sessionInvalidatedAt: new Date() } : {}),
    },
  });
