const PromoCode = require("../../models/PromoCode");
const PromoCodeUsage = require("../../models/PromoCodeUsage");
const { PROMO_USAGE_STATUS } = require("../../constants/promoCode");
const { throwError } = require("../../utils");
const { assertCoherent } = require("./createPromoCode");

exports.updatePromoCode = async (userId, id, payload) => {
  const promo = await PromoCode.findOne({ _id: id, isDeleted: false });
  if (!promo) throwError(404, "Promo code not found");

  await assertCoherent(payload, promo.toObject());

  // The code string is the identity vendors have already been given, and it is
  // referenced by every PromoCodeUsage row. Renaming it would orphan that
  // history, so it is immutable once created.
  if (payload.code && String(payload.code).toUpperCase() !== promo.code) {
    throwError(
      422,
      "A promo code's code cannot be changed. Deactivate this one and create a new code instead.",
    );
  }
  delete payload.code;

  // Lowering the total cap below what has already been claimed would make
  // `usedCount` permanently exceed the limit and silently disable the code.
  if (payload.totalUsageLimit && payload.totalUsageLimit < promo.usedCount) {
    throwError(
      422,
      `totalUsageLimit cannot be lower than the ${promo.usedCount} use(s) already claimed.`,
    );
  }

  Object.assign(promo, payload, { updatedBy: userId });
  await promo.save();

  const consumed = await PromoCodeUsage.countDocuments({
    promoCodeId: promo._id,
    status: PROMO_USAGE_STATUS.CONSUMED,
  });
  const reserved = await PromoCodeUsage.countDocuments({
    promoCodeId: promo._id,
    status: PROMO_USAGE_STATUS.RESERVED,
  });

  return { promoCode: promo, usage: { consumed, reserved } };
};
