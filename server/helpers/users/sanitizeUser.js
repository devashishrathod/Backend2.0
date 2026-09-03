const SENSITIVE_USER_FIELDS = Object.freeze(["password", "otp", "__v"]);

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
