const { generateReferralCode } = require("./generateReferralCode");
const { generateUniqueUserId } = require("./generateUniqueUserId");
const { sanitizeUser } = require("./sanitizeUser");
const { maskEmail, maskPhone } = require("./maskContact");
const {
  ROLE_PROFILES,
  profileForRole,
  findRoleProfile,
} = require("./roleProfiles");
const {
  applyIdentityChange,
  syncRoleProfileIdentity,
  IDENTITY_KEYS,
} = require("./applyIdentityChange");
const { assertCanWriteIdentity } = require("./canWriteIdentity");

module.exports = {
  generateReferralCode,
  generateUniqueUserId,
  sanitizeUser,
  maskEmail,
  maskPhone,
  /**
   * The identity layer: `email`, `mobile` and `whatsappNumber` on `User`, and
   * their mirror on the role profile.
   *
   * `applyIdentityChange` is the only thing that writes any of them —
   * `assertCanWriteIdentity` decides whether this caller may, and
   * `roleProfiles` says where the mirror lives.
   */
  ROLE_PROFILES,
  profileForRole,
  findRoleProfile,
  applyIdentityChange,
  /**
   * Mirror-only. Use it where no value changes but the copy may be stale — every
   * WhatsApp sign-in, the repair path, the sync script. `applyIdentityChange`
   * returns early when nothing moved, which is precisely the drifted case.
   */
  syncRoleProfileIdentity,
  IDENTITY_KEYS,
  assertCanWriteIdentity,
};
