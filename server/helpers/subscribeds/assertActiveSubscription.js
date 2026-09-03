const Brand = require("../../models/Brand");
const Subscription = require("../../models/Subscription");
const { throwError } = require("../../utils");
const { resolveEntitlements } = require("../subscriptions");
const { getActiveSubscription } = require("./getActiveSubscription");

/**
 * The one subscription gate every paid feature should sit behind.
 *
 * Replaces the scattered `brand.isSubscribed` / `subscribed.isExpired` checks:
 * those read cached booleans that could be stale, whereas this resolves the
 * live Subscribed doc (self-healing on the way) and hands back the plan's
 * entitlements so the caller can enforce a limit without a second round trip.
 *
 * @param {string|object} brandId
 * @param {object}  [options]
 * @param {string}  [options.feature]  entitlement flag key to require, e.g.
 *                                     "vouchers" — omit for a plain gate.
 * @param {string}  [options.featureLabel] wording used in the 403 message.
 * @returns {{ brand, subscribed, subscription, entitlements, entitlementsSource }}
 */
exports.assertActiveSubscription = async (
  brandId,
  { feature, featureLabel } = {},
) => {
  const brand = await Brand.findById(brandId);
  if (!brand || brand.isDeleted) throwError(404, "Brand not found!");

  const subscribed = await getActiveSubscription(brandId);
  if (!subscribed) {
    throwError(
      403,
      "Access denied. This feature requires an active subscription. Please subscribe to continue.",
    );
  }

  const subscription = await Subscription.findById(
    subscribed.subscriptionId,
  ).lean();
  if (!subscription) {
    throwError(404, "The subscription plan for this brand no longer exists.");
  }

  const { entitlements, source } = resolveEntitlements(subscription);

  if (feature && !entitlements?.[feature]?.isEnabled) {
    throwError(
      403,
      `Your current ${subscription.name} plan does not include ${featureLabel || feature}. Please upgrade your subscription to use this feature.`,
    );
  }

  return {
    brand,
    subscribed,
    subscription,
    entitlements,
    entitlementsSource: source,
  };
};
