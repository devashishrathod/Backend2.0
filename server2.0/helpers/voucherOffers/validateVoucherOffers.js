const { throwError } = require("../../utils");

exports.validateVoucherOffers = (offers = [], maxOffers = 10) => {
  if (!Array.isArray(offers)) offers = [offers];
  if (offers.length > maxOffers) {
    throwError(400, `Maximum ${maxOffers} offers are allowed.`);
  }
  const thresholdSet = new Set();
  offers.forEach((offer, index) => {
    if (!offer) {
      throwError(400, `Invalid offer at index ${index}.`);
    }
    const minBillAmount = Number(offer.minBillAmount);
    const discountValue = Number(offer.discountValue);
    if (!Number.isFinite(minBillAmount) || minBillAmount <= 0) {
      throwError(
        400,
        `Minimum bill amount must be greater than zero at offer ${index + 1}.`,
      );
    }
    if (thresholdSet.has(minBillAmount)) {
      throwError(
        400,
        `Duplicate minimum bill amount ${minBillAmount} is not allowed.`,
      );
    }
    thresholdSet.add(minBillAmount);
    if (
      offer.discountType !== "PERCENTAGE" &&
      offer.discountType !== "FIXED" &&
      offer.discountType !== "FLAT"
    ) {
      throwError(400, `Invalid discount type at offer ${index + 1}.`);
    }
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      throwError(
        400,
        `Discount value must be greater than zero at offer ${index + 1}.`,
      );
    }
    if (offer.discountType === "PERCENTAGE" && discountValue > 100) {
      throwError(
        400,
        `Percentage discount cannot exceed 100 at offer ${index + 1}.`,
      );
    }
    if (
      (offer.discountType === "FLAT" || offer.discountType === "FIXED") &&
      discountValue <= 0
    ) {
      throwError(400, "Flat discount must be greater than zero.");
    }
    if (
      offer.maxDiscountAmount !== undefined &&
      offer.maxDiscountAmount !== null
    ) {
      const maxDiscount = Number(offer.maxDiscountAmount);
      if (!Number.isFinite(maxDiscount) || maxDiscount <= 0) {
        throwError(
          400,
          `Invalid maximum discount amount at offer ${index + 1}.`,
        );
      }
    }
  });
  return true;
};
