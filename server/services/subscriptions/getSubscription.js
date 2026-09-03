const Subscription = require("../../models/Subscription");
const { throwError } = require("../../utils");

exports.getSubscription = async (id) => {
  const subscription = await Subscription.findOne({
    _id: id,
    isDeleted: false,
  });
  if (!subscription) throwError(404, "Subscription not found");
  return subscription;
};
