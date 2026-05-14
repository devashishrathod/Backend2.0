const Subscribed = require("../../model/Subscribed");

exports.getCurrentSubscriptionByBrand = async (brandId) => {
  return await Subscribed.findOne({
    brand: brandId,
    isDeleted: false,
    isActive: true,
    isExpired: false,
  }).populate("subscription transaction");
};
