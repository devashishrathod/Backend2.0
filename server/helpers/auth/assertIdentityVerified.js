const { throwError } = require("../../utils");
const { IDENTITY_KEYS } = require("../users/applyIdentityChange");

/**
 * ---------------- an unverified key is not a way in ----------------
 *
 * `POST /auth/login-with-email` and `POST /auth/login-with-mobile` look an
 * account up by one of its contact keys and send a one-time code **to that key**.
 * So whoever can write the key can read the code — which makes writing somebody's
 * email, on its own, a route into their account.
 *
 * Writing is already restricted (`helpers/users/canWriteIdentity.js`), but not to
 * the account holder alone: an admin may set anybody's, and a vendor may set
 * their own outlet managers'. Those are deliberate — a vendor created that staff
 * account — and they would hand over the login too, were it not for this.
 *
 * ### The rule
 *
 * > A contact key becomes a **sign-in identity** only once its own OTP has
 * > confirmed it. Until then it is just a stored value.
 *
 * ### ⚠️ This locks nobody out, and the reason is worth knowing
 *
 * `verifyEmailOTP` and `verifyMobileOTP` have **always** set their flag on every
 * successful sign-in. So anyone who has ever signed in this way already carries
 * `true` and never meets this check. What it refuses is precisely the set of rows
 * nobody has ever signed in with — which is exactly the set somebody *else* may
 * have written.
 *
 * And every account keeps another door:
 *
 * | Role | Other way in |
 * |---|---|
 * | CUSTOMER · VENDOR · SUB_VENDOR | WhatsApp OTP — that is how they signed up |
 * | ADMIN | Password. `POST /auth/register` requires one, and a WhatsApp number |
 *
 * The one real consequence: somebody who added an email through
 * `PUT /users/update` and never confirmed it cannot sign in with it until they
 * run `POST /auth/email/verify` once. That is the point.
 *
 * @param {object} user   the account found by that key
 * @param {"email"|"mobile"|"whatsappNumber"} key
 */
const assertIdentityVerified = (user, key) => {
  const spec = IDENTITY_KEYS[key];
  if (!spec) throwError(500, `assertIdentityVerified got an unknown key: ${key}`);

  if (user?.[spec.flag] === true) return;

  const label = key === "email" ? "email address" : "mobile number";
  throwError(
    403,
    `This ${label} has not been verified yet. Sign in another way and confirm it ` +
      `first, then you can use it to sign in.`,
    { code: "IDENTITY_NOT_VERIFIED", channel: key },
  );
};

module.exports = { assertIdentityVerified };
