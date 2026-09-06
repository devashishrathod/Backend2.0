const User = require("../../models/User");
const Brand = require("../../models/Brand");
const SubBrand = require("../../models/SubBrand");
const { ROLES, LOGIN_TYPES, OUTLET_TYPES } = require("../../constants");
const { DUPLICATE_KEY } = require("../../constants/mongo");
const { throwError } = require("../../utils");
const { sendOtp } = require("../../services/otps");
const {
  generateUniqueUserId,
  generateReferralCode,
} = require("../../helpers/users");
const { assertActiveSubscription } = require("../../helpers/subscribeds");
const { resolveActorBrand } = require("../../helpers/brands");
const {
  generateUniqueSubBrandId,
  generateSubBrandStoreId,
  reserveOutletSlot,
  releaseOutletSlot,
} = require("../../helpers/subBrands");

/**
 * Register a new outlet or franchise under a brand.
 *
 * This is where the plan's limits are actually enforced. Previously there were
 * no checks at all here — no subscription gate and no limit test — so a vendor
 * could add unlimited outlets, on any plan, or with no plan.
 *
 * Order matters:
 *  1. `assertActiveSubscription` proves there is a live plan (self-healing, so
 *     an expired plan is caught even if the expiry job has not run).
 *  2. `reserveOutletSlot` claims a slot with an atomic conditional increment.
 *     Two concurrent signups cannot both pass — the limit test and the
 *     increment are one operation, unlike a read-then-write check.
 *  3. Everything after that is wrapped so a failure gives the slot back rather
 *     than permanently consuming one from the vendor's quota.
 *
 * Outlets and franchises draw on separate pools, chosen by `outletType`.
 */
exports.signUpSubBrandWithWhatsapp = async (actor, payload) => {
  let { brandId, isFirstOutlet, whatsappNumber, outletType } = payload;
  outletType = outletType || OUTLET_TYPES.OUTLET;

  // Ownership first: a vendor may only add outlets to their own brand. The
  // route used to accept any brandId from any authenticated caller.
  const brand = await resolveActorBrand(actor, brandId);
  brandId = brand._id;

  whatsappNumber = whatsappNumber?.toLowerCase();
  const existing = await User.findOne({
    whatsappNumber,
    role: ROLES.SUB_VENDOR,
    isDeleted: false,
  })
    .select("_id")
    .lean();
  if (existing) {
    throwError(403, "Outlet/Sub-Brand is already registered with this number");
  }

  // Gate first, so a vendor with no plan gets "subscribe to continue" rather
  // than a limit message about a plan they do not have.
  await assertActiveSubscription(brandId);

  await reserveOutletSlot(brandId, outletType);

  let user;
  let subBrand;
  try {
    user = await User.create({
      whatsappNumber,
      role: ROLES.SUB_VENDOR,
      // No password. This account authenticates by OTP; giving every such user
      // the same DEFAULT_PASSWORD meant one known string logged into all of
      // them, and there was no flow to ever change it. A password is only set
      // when the user chooses one via POST /auth/set-password.
      uniqueId: await generateUniqueUserId(),
      referralCode: await generateReferralCode(),
    });
    subBrand = await SubBrand.create({
      userId: user._id,
      brandId,
      outletType,
      whatsappNumber,
      uniqueId: await generateUniqueSubBrandId(),
      storeId: await generateSubBrandStoreId(),
    });
    user.subBrandId = subBrand._id;
    await user.save();

    if (isFirstOutlet) {
      brand.firstSubBrandId = subBrand._id;
      await brand.save();
    }
    await sendOtp(LOGIN_TYPES.WHATSAPP, whatsappNumber);
  } catch (error) {
    // Hand the reserved slot back before rethrowing, otherwise a transient OTP
    // or DB failure silently costs the vendor one outlet from their plan.
    await releaseOutletSlot(brandId, outletType);
    if (subBrand?._id) {
      await SubBrand.deleteOne({ _id: subBrand._id }).catch(() => {});
    }
    if (user?._id) await User.deleteOne({ _id: user._id }).catch(() => {});

    /**
     * ⚠️ The `findOne` above is the polite refusal; `user_whatsappNumber_role_unique`
     * is the guard.
     *
     * That check and this `User.create` are separated by two generator round
     * trips, so two vendors adding the same outlet number at once both read
     * "not registered" and both reach here — the same ~200ms window that put
     * four accounts on one customer's phone number.
     *
     * The index refuses the second insert. Without this branch that surfaced as
     * a generic `422` naming an index, so the vendor was told their input was
     * invalid when the real answer is the one the check above already had a
     * sentence for.
     */
    if (error?.code === DUPLICATE_KEY) {
      throwError(403, "Outlet/Sub-Brand is already registered with this number");
    }
    throw error;
  }

  const updated = await Brand.findById(brandId)
    .select(
      "subBrandsUsed subBrandsLimit isSubBrandsUnlimited franchisesUsed franchisesLimit isFranchisesUnlimited",
    )
    .lean();

  return {
    user,
    subBrand,
    usage: {
      subBrands: {
        used: updated.subBrandsUsed ?? 0,
        limit: updated.isSubBrandsUnlimited
          ? null
          : (updated.subBrandsLimit ?? 0),
        isUnlimited: Boolean(updated.isSubBrandsUnlimited),
      },
      franchises: {
        used: updated.franchisesUsed ?? 0,
        limit: updated.isFranchisesUnlimited
          ? null
          : (updated.franchisesLimit ?? 0),
        isUnlimited: Boolean(updated.isFranchisesUnlimited),
      },
    },
  };
};
