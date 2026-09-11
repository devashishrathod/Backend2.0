const Brand = require("../../models/Brand");
const Customer = require("../../models/Customer");
const SubBrand = require("../../models/SubBrand");
const { ROLES } = require("../../constants");

/**
 * ---------------- which collection holds a role's profile ----------------
 *
 * Three roles carry a side profile and one does not. This table says which, and
 * which `User` field points at it.
 *
 * ### Why it lives here rather than beside its first caller
 *
 * It began inside `services/auth/loginOrSignUpWithWhatsapp.js`, whose own comment
 * explains the reason it existed at all: *"Keeping this in one place means the
 * create path and the repair path can never disagree about what a role needs."*
 * That was right, and then a third and fourth path appeared — the identity mirror
 * and the sync script — and they could not reach it.
 *
 * So it moves out. The signup service still owns how to **build** a new profile
 * (generating a `uniqueId`, a `merchantId`, a `storeId` is signup's business);
 * what moves is the part everybody needs: *where does this role's profile live,
 * and how do I find it.*
 *
 * ⚠️ `SUB_VENDOR` is in this table but **not** in the signup service's, and that
 * is not an oversight. An outlet manager's `SubBrand` is created by their parent
 * brand through `POST /subBrands/signUp-with-whatsapp`, never by the public login
 * route. They still hold a profile that has to be kept in step, though, which is
 * exactly the gap that let `SubBrand.whatsappNumber` drift from the account it
 * belongs to.
 *
 * ⚠️ `ADMIN` is absent **on purpose**. An admin is only ever a `User`. Every
 * caller here must treat "no profile for this role" as a normal answer rather
 * than a failure, or the whole identity layer needs a second code path for one
 * role.
 */
const ROLE_PROFILES = Object.freeze({
  [ROLES.VENDOR]: Object.freeze({
    model: Brand,
    userField: "brandId",
    label: "Brand",
  }),
  [ROLES.CUSTOMER]: Object.freeze({
    model: Customer,
    userField: "customerId",
    label: "Customer",
  }),
  [ROLES.SUB_VENDOR]: Object.freeze({
    model: SubBrand,
    userField: "subBrandId",
    label: "SubBrand",
  }),
});

/** The profile descriptor for a role, or `null` for ADMIN. */
const profileForRole = (role) => ROLE_PROFILES[role] || null;

/**
 * This user's profile document, or `null`.
 *
 * ⚠️ Looked up by **`userId`**, not by the id cached on the user.
 * `user[userField]` can be absent on an account left half-created by a signup
 * that failed between the two writes — `repairRoleProfile` exists for exactly
 * that shape — and an identity mirror that gave up there would skip precisely the
 * accounts most likely to be wrong. The reverse lookup finds the profile either
 * way, and it is the one this collection is indexed for (`customerSchema.index({
 * userId: 1 })`, and the equivalent on SubBrand).
 *
 * @param {object} user            a User document or lean object
 * @param {object} [options]
 * @param {object} [options.session]  a mongoose session, when inside a transaction
 * @returns {Promise<object|null>}
 */
const findRoleProfile = async (user, { session } = {}) => {
  const profile = profileForRole(user?.role);
  if (!profile || !user?._id) return null;

  const query = profile.model.findOne({ userId: user._id, isDeleted: false });
  if (session) query.session(session);
  return query;
};

module.exports = { ROLE_PROFILES, profileForRole, findRoleProfile };
