const SubBrand = require("../../models/SubBrand");
const Brand = require("../../models/Brand");
const { ROLES } = require("../../constants");
const { throwError } = require("../../utils");

/**
 * ---------------- whose contact details may I change ----------------
 *
 * | Actor | May write the identity of |
 * |---|---|
 * | `ADMIN` | anybody |
 * | `VENDOR` | themselves, and **their own** outlet managers |
 * | `SUB_VENDOR` | themselves |
 * | `CUSTOMER` | themselves |
 *
 * ### ⚠️ Why this is a gate and not a formality
 *
 * `email` and `mobile` are login identities: `POST /auth/login-with-email` and
 * `POST /auth/login-with-mobile` both look an account up by one of them and send
 * a one-time code to it. So writing somebody's email is, on its own, a route into
 * their account — set it to an address you control, ask for a code, read it.
 *
 * Two things stop that from being an open door, and they work at different
 * levels. This function decides **who may write at all**. The verified flag,
 * checked by the login services, decides **whether that write becomes a way in** —
 * an address written by anyone other than the account holder lands unverified,
 * and an unverified address cannot be signed in with.
 *
 * A vendor writing their own outlet manager's email is *allowed* — they created
 * that account and it is their staff — but it still lands unverified, so it does
 * not hand them the login.
 *
 * `whatsappNumber` is not writable through any of these paths at all; see
 * `applyIdentityChange`.
 */

/**
 * Refuse unless `actor` may write `target`'s identity keys.
 *
 * @param {object} actor   `{ userId, role }` — from the token, never from a body
 * @param {object} target  the User document whose keys are being written
 * @returns {Promise<void>}  resolves silently, or throws 403
 */
const assertCanWriteIdentity = async (actor, target) => {
  if (!actor?.userId || !target?._id) {
    throwError(500, "assertCanWriteIdentity was given an incomplete actor or target");
  }

  // Everybody may edit their own.
  if (String(actor.userId) === String(target._id)) return;

  if (actor.role === ROLES.ADMIN) return;

  /**
   * A vendor reaches their outlet managers, and **only** theirs.
   *
   * Resolved through the outlet rather than through anything on the token: the
   * link that matters is `SubBrand.brandId → Brand.userId`, and reading it from
   * the documents is what makes "their own" mean the same thing here as it does
   * in `updateSubBrand`'s own ownership check.
   */
  if (actor.role === ROLES.VENDOR && target.role === ROLES.SUB_VENDOR) {
    const outlet = await SubBrand.findOne({ userId: target._id, isDeleted: false })
      .select("brandId")
      .lean();

    if (outlet?.brandId) {
      const brand = await Brand.findOne({ _id: outlet.brandId, isDeleted: false })
        .select("userId")
        .lean();
      if (brand && String(brand.userId) === String(actor.userId)) return;
    }
  }

  throwError(
    403,
    "You cannot change this account's contact details. Only the account holder " +
      "can, or an administrator.",
    { code: "IDENTITY_WRITE_FORBIDDEN" },
  );
};

module.exports = { assertCanWriteIdentity };
