const PromoCode = require("../../models/PromoCode");
const PromoCodeUsage = require("../../models/PromoCodeUsage");
const {
  PROMO_USAGE_STATUS,
  PROMO_COST_BEARING_MODE,
} = require("../../constants/promoCode");
const { throwError } = require("../../utils");
const { assertCoherent } = require("./createPromoCode");

exports.updatePromoCode = async (userId, id, payload) => {
  const promo = await PromoCode.findOne({ _id: id, isDeleted: false });
  if (!promo) throwError(404, "Promo code not found");

  // `costBearing` is the one nested object in the payload, and `Object.assign`
  // REPLACES it rather than merging — a PATCH of `{ costBearing: { mode } }`
  // drops the stored `vendorPercent` entirely. Verified against the live schema:
  // the result is `{ mode: "SHARED" }` with no percent at all, not even the
  // default, so a shared-cost code would silently settle nothing to the vendor.
  //
  // Merging here rather than inside `assertCoherent` keeps validation and the
  // write looking at the same values — `assertCoherent` already falls back to
  // the stored percent, so without this it would approve a 40% split and then
  // save a code that has none.
  if (payload.costBearing) {
    const stored = promo.costBearing?.toObject?.() ?? promo.costBearing ?? {};
    const merged = { ...stored, ...payload.costBearing };

    // `vendorPercent` only means anything under SHARED. Carrying a stale one
    // forward when the admin switches to PLATFORM or VENDOR would reject a PATCH
    // over a field they never sent — so an explicit move away from SHARED drops
    // it, unless they set it themselves in the same request.
    if (
      merged.mode !== PROMO_COST_BEARING_MODE.SHARED &&
      payload.costBearing.vendorPercent === undefined
    ) {
      merged.vendorPercent = 0;
    }

    payload.costBearing = merged;
  }

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
