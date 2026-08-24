const { SUBSCRIPTION_ACTION } = require("../../constants/subscription");
const { daysRemaining } = require("./formatDuration");

/**
 * Work out what buying `target` would mean for a brand right now.
 *
 * Plans are ranked purely by price, which is the only ordering the data
 * actually gives us. A different plan at the same price is treated as an
 * upgrade (flagged `isSideGrade`) so it is never blocked by the downgrade
 * policy — the vendor is not losing value.
 *
 * @param {object|null} active   the live Subscribed doc, or null
 * @param {object|null} current  the plan `active` refers to
 * @param {object}      target   the plan being bought
 */
exports.resolveSubscriptionAction = (active, current, target) => {
  if (!active) {
    return { action: SUBSCRIPTION_ACTION.NEW, isSideGrade: false, current: null };
  }

  const currentPlan = current
    ? {
        _id: current._id,
        name: current.name,
        type: current.type,
        price: current.price,
        endDate: active.endDate,
        startDate: active.startDate,
        daysRemaining: daysRemaining(active.endDate),
      }
    : null;

  const isSamePlan =
    String(active.subscriptionId || "") === String(target?._id || "");
  if (isSamePlan) {
    return {
      action: SUBSCRIPTION_ACTION.RENEW,
      isSideGrade: false,
      current: currentPlan,
    };
  }

  const currentPrice = Number(current?.price) || 0;
  const targetPrice = Number(target?.price) || 0;

  if (targetPrice < currentPrice) {
    return {
      action: SUBSCRIPTION_ACTION.DOWNGRADE,
      isSideGrade: false,
      current: currentPlan,
    };
  }

  return {
    action: SUBSCRIPTION_ACTION.UPGRADE,
    isSideGrade: targetPrice === currentPrice,
    current: currentPlan,
  };
};
