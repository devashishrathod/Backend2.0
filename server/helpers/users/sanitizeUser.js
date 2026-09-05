/**
 * ⚠️ `meta` is in this list, and it is the one entry that is not obviously a
 * credential.
 *
 * It holds `fcmToken`, `ipAddress`, `deviceId` — the push token in particular is
 * a capability: whoever has it can address notifications at that device. Echoing
 * it back in a login response puts it into client logs and crash reports for no
 * benefit, because nothing reads it there. A client that wants to know which
 * devices are registered has `GET /deviceTokens/get-mine`.
 *
 * Checked before adding: `meta` appears in **zero** captured Postman examples
 * and **zero** documented response shapes. (The `meta` visible in search results
 * is a different object on a different document and is untouched by this.)
 *
 * `otp` is kept here as a guard rather than a fact — the `User` schema has no
 * such path today, so deleting it is a no-op that costs nothing and keeps
 * working if one is ever added.
 */
const SENSITIVE_USER_FIELDS = Object.freeze([
  "password",
  "otp",
  "__v",
  "meta",
]);

/**
 * Strip credentials off a User before it goes out over HTTP.
 *
 * The auth services return the whole Mongoose document, which carries the bcrypt
 * hash for any account that has been through `POST /auth/set-password`. That
 * hash then reaches client logs, crash reports and analytics payloads — none of
 * which should ever hold it.
 *
 * `getUserById` already projects these away with `.select("-password -otp")`;
 * this is the same guarantee for the paths that hand back a document they just
 * created or saved, where a projection is not available.
 *
 * Accepts a Mongoose document or a plain object, and always returns a plain
 * object so the caller cannot accidentally re-save a stripped document.
 *
 * @param {object|null} user
 * @returns {object|null}
 */
exports.sanitizeUser = (user) => {
  if (!user) return null;

  const plain = typeof user.toObject === "function" ? user.toObject() : { ...user };
  for (const field of SENSITIVE_USER_FIELDS) delete plain[field];

  return plain;
};

exports.SENSITIVE_USER_FIELDS = SENSITIVE_USER_FIELDS;
