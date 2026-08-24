const PromoCode = require("../../models/PromoCode");
const { throwError } = require("../../utils");

/**
 * Soft-delete a promo code.
 *
 * Never a hard delete: `PromoCodeUsage` rows reference it, and those are the
 * discount ledger. Deactivating also stops it being accepted at checkout, so
 * this is only for taking a code out of the admin list entirely.
 */
exports.deletePromoCode = async (userId, id) => {
  const promoCode = await PromoCode.findOne({ _id: id, isDeleted: false });
  if (!promoCode) throwError(404, "Promo code not found");

  promoCode.isDeleted = true;
  promoCode.isActive = false;
  promoCode.updatedBy = userId;
  await promoCode.save();

  return { deletedPromoCodeId: promoCode._id, code: promoCode.code };
};
