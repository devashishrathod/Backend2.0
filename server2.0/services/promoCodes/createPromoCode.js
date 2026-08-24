const PromoCode = require("../../models/PromoCode");
const Subscription = require("../../models/Subscription");
const { PROMO_DISCOUNT_TYPES } = require("../../constants/promoCode");
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
