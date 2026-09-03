const PromoCode = require("../../models/PromoCode");
const Subscription = require("../../models/Subscription");
const Voucher = require("../../models/Voucher");
const Brand = require("../../models/Brand");
const Category = require("../../models/Category");
const {
  PROMO_DISCOUNT_TYPES,
  PROMO_AUDIENCE,
  PROMO_COST_BEARING_MODE,
} = require("../../constants/promoCode");
const { throwError } = require("../../utils");

/**
 * Validate the internal consistency of a promo code definition.
 *
 * Joi checks field types; this checks the combinations Joi cannot express — a
 * PERCENT code with no percentage, a window that ends before it starts, a cap
 * that can never bite.
 */
exports.assertCoherent = async (payload, existing = {}) => {
  const discountType = payload.discountType ?? existing.discountType;
  const discountPercent = payload.discountPercent ?? existing.discountPercent;
  const discountAmount = payload.discountAmount ?? existing.discountAmount;

  if (discountType === PROMO_DISCOUNT_TYPES.PERCENT && !discountPercent) {
    throwError(422, "A PERCENT promo code needs a discountPercent above 0.");
  }
  if (discountType === PROMO_DISCOUNT_TYPES.FLAT && !discountAmount) {
    throwError(422, "A FLAT promo code needs a discountAmount above 0.");
  }
  if (
    discountType === PROMO_DISCOUNT_TYPES.FLAT &&
    payload.maxDiscountAmount
  ) {
    throwError(
      422,
      "maxDiscountAmount only applies to a PERCENT code — a FLAT code is already a fixed amount.",
    );
  }

  const validFrom = payload.validFrom ?? existing.validFrom;
  const validTill = payload.validTill ?? existing.validTill;
  if (validFrom && validTill && new Date(validFrom) >= new Date(validTill)) {
    throwError(422, "validTill must be after validFrom.");
  }

  const totalLimit = payload.totalUsageLimit ?? existing.totalUsageLimit;
  const perBrand = payload.perBrandUsageLimit ?? existing.perBrandUsageLimit;
  if (totalLimit && perBrand && perBrand > totalLimit) {
    throwError(
      422,
      "perBrandUsageLimit cannot exceed totalUsageLimit.",
    );
  }

  // Referencing a plan that does not exist would silently make the code
  // unusable rather than erroring at checkout.
  if (payload.subscriptionIds?.length) {
    const found = await Subscription.countDocuments({
      _id: { $in: payload.subscriptionIds },
      isDeleted: false,
    });
    if (found !== payload.subscriptionIds.length) {
      throwError(422, "One or more subscriptionIds do not exist.");
    }
  }

  // ---------- audience ----------
  const audience = payload.audience ?? existing.audience ?? PROMO_AUDIENCE.VENDOR;
  const isCustomer = audience === PROMO_AUDIENCE.CUSTOMER;

  // Immutable once created, for the same reason `code` is: every PromoCodeUsage
  // row froze this value at claim time, and the per-owner cap is counted by it.
  // Flipping it would orphan that history — the old rows would stop counting
  // toward the cap, so a single-use code could be redeemed a second time.
  //
  // `existing.audience` is absent on codes created before this field existed;
  // those are VENDOR by convention, so setting VENDOR on one is a no-op rather
  // than a change, but promoting one to CUSTOMER is still refused.
  const existingAudience = existing.audience ?? (existing._id ? PROMO_AUDIENCE.VENDOR : null);
  if (existingAudience && payload.audience && payload.audience !== existingAudience) {
    throwError(
      422,
      `A promo code's audience cannot be changed from ${existingAudience} to ${payload.audience} — its redemption history is counted per audience. Deactivate this one and create a new code instead.`,
    );
  }

  // Scope fields belong to one audience or the other. A code carrying the wrong
  // ones is not an error at checkout — it simply never matches, which is far
  // harder to diagnose than a 422 at creation.
  const VENDOR_ONLY = ["subscriptionIds", "applicableActions", "firstTimeOnly", "perBrandUsageLimit", "minOrderValue"];
  const CUSTOMER_ONLY = ["voucherIds", "categoryIds", "perCustomerUsageLimit", "firstOrderOnly", "minBillAmount", "appliesTo"];

  const misplaced = (isCustomer ? VENDOR_ONLY : CUSTOMER_ONLY).filter(
    (f) => payload[f] !== undefined && payload[f] !== null,
  );
  if (misplaced.length) {
    throwError(
      422,
      `${misplaced.join(", ")} ${misplaced.length > 1 ? "are" : "is"} not valid on a ${audience} promo code.`,
    );
  }

  const perCustomer =
    payload.perCustomerUsageLimit ?? existing.perCustomerUsageLimit;
  const totalLimitForCustomer = payload.totalUsageLimit ?? existing.totalUsageLimit;
  if (totalLimitForCustomer && perCustomer && perCustomer > totalLimitForCustomer) {
    throwError(422, "perCustomerUsageLimit cannot exceed totalUsageLimit.");
  }

  // ---------- who funds the discount ----------
  // Merged against the stored document on purpose: on a PATCH, Joi sees only
  // `{ costBearing: { mode: "VENDOR" } }` and has no way to know the stored code
  // has no brandIds. Without this an unscoped vendor-funded code goes live and
  // deducts from whichever brand the customer happens to visit.
  const mode =
    payload.costBearing?.mode ??
    existing.costBearing?.mode ??
    PROMO_COST_BEARING_MODE.PLATFORM;
  const vendorPercent =
    payload.costBearing?.vendorPercent ?? existing.costBearing?.vendorPercent ?? 0;
  const brandIds = payload.brandIds ?? existing.brandIds ?? [];

  if (mode !== PROMO_COST_BEARING_MODE.PLATFORM) {
    if (!isCustomer) {
      throwError(
        422,
        "costBearing applies to CUSTOMER promo codes — a subscription discount is always funded by the platform.",
      );
    }
    if (!brandIds.length) {
      throwError(
        422,
        `A ${mode} promo code must be scoped with brandIds. Without it the discount would be deducted from whichever brand the customer happens to visit.`,
      );
    }
  }

  if (mode === PROMO_COST_BEARING_MODE.SHARED) {
    if (!(vendorPercent > 0 && vendorPercent < 100)) {
      throwError(
        422,
        "A SHARED promo code needs a vendorPercent between 1 and 99. Use PLATFORM for 0 or VENDOR for 100.",
      );
    }
  } else if (vendorPercent) {
    throwError(
      422,
      `vendorPercent only applies to a SHARED promo code — ${mode} already decides who pays in full.`,
    );
  }

  // Scoped ids that do not exist make a code silently unusable, same as plans.
  for (const [field, Model, label] of [
    ["voucherIds", Voucher, "voucherIds"],
    ["brandIds", Brand, "brandIds"],
    ["categoryIds", Category, "categoryIds"],
  ]) {
    if (!payload[field]?.length) continue;
    const found = await Model.countDocuments({
      _id: { $in: payload[field] },
      isDeleted: false,
    });
    if (found !== payload[field].length) {
      throwError(422, `One or more ${label} do not exist.`);
    }
  }
};

exports.createPromoCode = async (userId, payload) => {
  await exports.assertCoherent(payload);

  const code = String(payload.code).trim().toUpperCase();
  const existing = await PromoCode.findOne({ code });
  if (existing) {
    throwError(409, `Promo code "${code}" already exists.`);
  }

  return PromoCode.create({ ...payload, code, createdBy: userId });
};
