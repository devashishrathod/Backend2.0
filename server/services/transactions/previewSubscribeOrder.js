const Subscription = require("../../models/Subscription");
const { throwError } = require("../../utils");
const { resolveActorBrand } = require("../../helpers/brands");
const { buildCheckoutPreview } = require("../../helpers/subscribeds");

/**
 * Checkout preview — everything the vendor sees before paying.
 *
 * Read-only: no Razorpay call, no Transaction row, no state change. Safe to hit
 * on every render, and on plan-card switching.
 *
 * The amount here is produced by the same code path order creation uses, so the
 * "You'll Pay" figure shown is the figure that reaches Razorpay.
 */
exports.previewSubscribeOrder = async (actor, payload) => {
  const { subscriptionId, brandId, promoCode } = payload;

  const brand = await resolveActorBrand(actor, brandId);

  const subscription = await Subscription.findById(subscriptionId).lean();
  if (!subscription || subscription.isDeleted) {
    throwError(404, "Subscription plan not found!");
  }
  if (!subscription.isActive) {
    throwError(422, "This subscription plan is no longer available.");
  }

  const { response } = await buildCheckoutPreview(brand, subscription, actor, {
    promoCode,
  });
  return response;
};
