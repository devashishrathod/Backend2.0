const Subscription = require("../../model/Subscription");
const { findOne } = require("../../db/dbServices");

exports.getActiveSubscriptionPlanById = async (id) => {
  return await findOne(Subscription, {
    _id: id,
    isDeleted: false,
    isActive: true,
  });
};
