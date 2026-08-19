exports.normalizeVoucherOffers = (offers = []) => {
  return [...offers]
    .sort((a, b) => Number(a.minBillAmount) - Number(b.minBillAmount))
    .map((offer, index) => ({
      minBillAmount: Number(offer.minBillAmount),
      discountType: offer.discountType,
      discountValue: Number(offer.discountValue),
      maxDiscountAmount:
        offer.maxDiscountAmount === undefined ||
        offer.maxDiscountAmount === null
          ? null
          : Number(offer.maxDiscountAmount),
      title: offer.title,
      usageType:
        offer.usageType === undefined || offer.usageType === null
          ? null
          : offer.usageType,
      discountApplicableOn:
        offer.discountApplicableOn === undefined ||
        offer.discountApplicableOn === null
          ? null
          : offer.discountApplicableOn,
      sortOrder: index + 1,
      isActive: offer.isActive !== false,
    }));
};
