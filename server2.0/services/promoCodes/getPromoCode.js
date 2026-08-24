const PromoCode = require("../../models/PromoCode");
const PromoCodeUsage = require("../../models/PromoCodeUsage");
const { PROMO_USAGE_STATUS } = require("../../constants/promoCode");
const { throwError } = require("../../utils");

/**
 * One promo code plus its redemption ledger.
 *
 * The ledger is what makes a discount auditable — who redeemed it, on which
 * transaction, for how much. `usedCount` alone cannot answer that.
 */
exports.getPromoCode = async (id) => {
  const promoCode = await PromoCode.findOne({
    _id: id,
    isDeleted: false,
  }).populate("subscriptionIds", "name price type");
  if (!promoCode) throwError(404, "Promo code not found");

  const usages = await PromoCodeUsage.find({ promoCodeId: promoCode._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate("brandId", "brandName merchantId")
    .lean();

  const tally = usages.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});

  return {
    promoCode,
    usage: {
      consumed: tally[PROMO_USAGE_STATUS.CONSUMED] || 0,
      reserved: tally[PROMO_USAGE_STATUS.RESERVED] || 0,
      released: tally[PROMO_USAGE_STATUS.RELEASED] || 0,
      remaining: promoCode.totalUsageLimit
        ? Math.max(0, promoCode.totalUsageLimit - promoCode.usedCount)
        : null,
    },
    // Most recent 50 claims.
    recentUsages: usages,
  };
};
