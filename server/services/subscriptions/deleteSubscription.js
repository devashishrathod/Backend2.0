const Subscription = require("../../models/Subscription");
const { throwError } = require("../../utils");

exports.deleteSubscription = async (id) => {
  const subscription = await Subscription.findOne({
    _id: id,
    isDeleted: false,
  });
  if (!subscription) throwError(404, "Subscription not found");
  subscription.isDeleted = true;
  subscription.isActive = false;
  subscription.updatedAt = new Date();
  await subscription.save();
  return;
};
