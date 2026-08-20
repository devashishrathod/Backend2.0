const { throwError } = require("../../utils");

exports.calculateVoucherOffer = ({ offers = [], billAmount }) => {
  const amount = Number(billAmount);

  if (!Number.isFinite(amount) || amount <= 0) {
    throwError(400, "Valid bill amount is required.");
  }

  if (!Array.isArray(offers) || !offers.length) {
    throwError(400, "No offers available for this voucher.");
  }

  const now = new Date();

  const eligibleOffers = offers
    .filter((offer) => {
      if (!offer) return false;

      if (offer.isDeleted === true || offer.isActive === false) {
        return false;
      }

      if (offer.startAt && new Date(offer.startAt) > now) {
        return false;
      }

      if (offer.endAt && new Date(offer.endAt) <= now) {
        return false;
      }

      const minAmount = Number(offer.minBillAmount || 0);
      return amount >= minAmount;
    })
    .map((offer) => {
      const minAmount = Number(offer.minBillAmount || 0);
      let discountAmount = 0;
      if (offer.discountType === "PERCENTAGE") {
        const percentage = Number(offer.discountValue);
        discountAmount = (amount * percentage) / 100;
        if (
          offer.maxDiscountAmount !== undefined &&
          offer.maxDiscountAmount !== null
        ) {
          discountAmount = Math.min(
            discountAmount,
            Number(offer.maxDiscountAmount),
          );
        }
      }
      if (offer.discountType === "FLAT") {
        discountAmount = Number(offer.discountValue);
      }
      discountAmount = Math.min(discountAmount, amount);
      return {
        offerId: offer._id,
        title: offer.title || null,
        discountType: offer.discountType,
        discountValue: offer.discountValue,
        minBillAmount: minAmount,
        maxDiscountAmount: offer.maxDiscountAmount ?? null,
        discountAmount: Number(discountAmount.toFixed(2)),
        // earnAmount: Number(billAmount) - Number(discountAmount.toFixed(2)),
        finalAmount: Number((amount - discountAmount).toFixed(2)),
      };
    })
    .filter((offer) => offer.discountAmount > 0);

  if (!eligibleOffers.length) {
    throwError(400, "No eligible offer found for this bill amount.");
  }

  /**
   * Best discount wins.
   *
   * If two offers give same discount,
   * higher minimum purchase tier wins.
   */

  eligibleOffers.sort((a, b) => {
    if (b.discountAmount !== a.discountAmount) {
      return b.discountAmount - a.discountAmount;
    }
    return b.minBillAmount - a.minBillAmount;
  });
  return {
    billAmount: Number(amount.toFixed(2)),
    selectedOffer: eligibleOffers[0],
    eligibleOffers,
  };
};
