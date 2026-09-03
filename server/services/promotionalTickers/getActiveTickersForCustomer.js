const PromotionalTicker = require("../../models/PromotionalTicker");

exports.getActiveTickersForCustomer = async () => {
  const now = new Date();
  return PromotionalTicker.find({
    isActive: true,
    isDeleted: false,
    $or: [
      { startDate: { $lte: now }, endDate: { $gte: now } },
      { startDate: null, endDate: null },
    ],
  }).sort({ displayOrder: 1 });
};
