const Subscribed = require("../../model/Subscribed");

exports.getAllSubscriptionByBrand = async (brandId) => {
  return await Subscribed.find({ brand: brandId, isDeleted: false })
    .populate("transaction")
    .populate("previousPlans.subscription")
    .populate("previousPlans.subscribedBy")
    .populate("previousPlans.transaction")
    .sort({ createdAt: -1 });
};
