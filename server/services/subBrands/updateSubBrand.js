const SubBrand = require("../../models/SubBrand");
const Brand = require("../../models/Brand");
const User = require("../../models/User");
const { ROLES } = require("../../constants");
const { DUPLICATE_KEY } = require("../../constants/mongo");
const { throwError } = require("../../utils");
const { assertActiveSubscription } = require("../../helpers/subscribeds");
const { switchOutletType } = require("../../helpers/subBrands");
const {
  applyIdentityChange,
  assertCanWriteIdentity,
} = require("../../helpers/users");

/**
 * Update an outlet / sub-brand.
 *
 * Fixes three problems in the previous version:
 *
 *  1. **No ownership check.** `userId` was accepted and never used, so any
 *     authenticated user could edit any outlet belonging to anyone.
 *  2. **`outletType` was assigned blindly.** Outlets and franchises are metered
 *     separately, so switching type frees a slot in one pool and must claim one
 *     in the other — and can legitimately be refused when the target pool is
 *     full or absent from the plan.
 *  3. **`isActive` silently defaulted to true** in the validator, so any update
 *     that omitted it reactivated a deactivated outlet. It is now only applied
 *     when explicitly sent.
 */
exports.updateSubBrand = async (actor, payload) => {
  const { subBrandId, joinedDate, outletType, email, description, isActive } =
    payload;

  const subBrand = await SubBrand.findById(subBrandId);
  if (!subBrand || subBrand.isDeleted) {
    throwError(404, "Outlet/Sub-Brand not found!");
  }

  const brand = await Brand.findById(subBrand.brandId);
  if (!brand || brand.isDeleted) throwError(404, "Brand not found!");

  // Admins may edit any outlet; a vendor only their own brand's.
  if (
    actor.role !== ROLES.ADMIN &&
    String(brand.userId) !== String(actor.userId)
  ) {
    throwError(
      403,
      "Forbidden: You do not have permission to update this outlet.",
    );
  }

  const isTypeChanging =
    Boolean(outletType) && outletType !== subBrand.outletType;
  let revertCounters = null;

  if (isTypeChanging) {
    // Changing type consumes a slot in the target pool, so it needs a live plan
    // for the same reason creating an outlet does.
    await assertActiveSubscription(brand._id);
    const { revert } = await switchOutletType(
      brand._id,
      subBrand.outletType,
      outletType,
    );
    revertCounters = revert;
    subBrand.outletType = outletType;
  }

  if (joinedDate) subBrand.joinedDate = new Date(joinedDate);

  /**
   * ---------------- the outlet's email is its manager's account email ----------
   *
   * `SubBrand.email` used to be written straight here, and it is the copy
   * `notify()` reaches for. Meanwhile the outlet manager's own `User.email` — the
   * one they could sign in with — was left untouched. Two values for one person,
   * and the one nobody was maintaining is the one delivery used.
   *
   * ⚠️ A vendor **may** set this: they created the account and it is their staff.
   * `assertCanWriteIdentity` enforces that it is *their own* outlet, and an admin
   * may do it for anybody.
   *
   * ⚠️ It lands **unverified**, which is what stops it from being a way into the
   * outlet manager's account. `loginWithEmailOTP` refuses an unverified address,
   * so setting one here does not hand the vendor that login — only the manager
   * themselves can confirm it, from their own session.
   */
  if (email !== undefined) {
    const outletUser = await User.findOne({
      _id: subBrand.userId,
      isDeleted: false,
    });
    if (!outletUser) throwError(404, "The outlet's user account no longer exists.");

    await assertCanWriteIdentity(actor, outletUser);

    const taken = await User.findOne({
      email,
      role: outletUser.role,
      _id: { $ne: outletUser._id },
      isDeleted: false,
    })
      .select("_id")
      .lean();
    if (taken) {
      throwError(409, "That email address is already in use on another account.");
    }

    try {
      await applyIdentityChange(
        outletUser,
        { email },
        // `profile: subBrand` — already loaded, and saved a few lines below.
        { verified: false, profile: subBrand },
      );
    } catch (error) {
      if (error?.code === DUPLICATE_KEY) {
        throwError(
          409,
          "That email address was taken while you were saving. Try a different one.",
        );
      }
      throw error;
    }
  }

  if (description) subBrand.description = description;
  // Only when the caller actually sent it — see note 3 above.
  if (isActive !== undefined) subBrand.isActive = isActive;

  try {
    await subBrand.save();
  } catch (error) {
    // Undo the counter movement so the pools do not drift from reality.
    if (revertCounters) await revertCounters();
    throw error;
  }

  const updatedBrand = await Brand.findById(brand._id)
    .select(
      "subBrandsUsed subBrandsLimit isSubBrandsUnlimited franchisesUsed franchisesLimit isFranchisesUnlimited",
    )
    .lean();

  return {
    subBrand,
    outletTypeChanged: isTypeChanging,
    usage: {
      subBrands: {
        used: updatedBrand.subBrandsUsed ?? 0,
        limit: updatedBrand.isSubBrandsUnlimited
          ? null
          : (updatedBrand.subBrandsLimit ?? 0),
        isUnlimited: Boolean(updatedBrand.isSubBrandsUnlimited),
      },
      franchises: {
        used: updatedBrand.franchisesUsed ?? 0,
        limit: updatedBrand.isFranchisesUnlimited
          ? null
          : (updatedBrand.franchisesLimit ?? 0),
        isUnlimited: Boolean(updatedBrand.isFranchisesUnlimited),
      },
    },
  };
};
