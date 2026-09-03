const SubBrand = require("../../models/SubBrand");
const Brand = require("../../models/Brand");
const { ROLES } = require("../../constants");
const { throwError } = require("../../utils");
const { assertActiveSubscription } = require("../../helpers/subscribeds");
const { switchOutletType } = require("../../helpers/subBrands");

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
  if (email) subBrand.email = email;
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
