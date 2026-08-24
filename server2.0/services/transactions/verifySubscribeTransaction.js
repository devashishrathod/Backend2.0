const Transaction = require("../../models/Transaction");
const Subscribed = require("../../models/Subscribed");
const { ROLES } = require("../../constants");
const {
  PAYMENT_GATEWAYS,
  SUBSCRIPTION_SOURCE,
} = require("../../constants/subscription");
const { throwError } = require("../../utils");
const {
  getActiveSubscription,
  settleSubscriptionPayment,
} = require("../../helpers/subscribeds");
const {
  generateRazorpaySignature,
  getPaymentDetails,
} = require("../../helpers/transactions");

/**
 * Verify a Razorpay payment from the client callback and activate the plan.
 *
 * This endpoint authenticates the caller and the payment; the settlement itself
 * lives in `helpers/subscribeds/settleSubscriptionPayment.js`, shared with the
 * webhook. Both paths therefore apply the same money checks, activation, promo
 * commit, invoice and screen advance — there is no second implementation to
 * drift.
 *
 * The two paths race by design (the browser callback and the webhook usually
 * land within milliseconds). The shared settlement claims the transaction with a
 * conditional update on `verified: false`, so exactly one of them activates and
 * the other is told the plan is already live.
 *
 * Rewritten earlier around four things the original got wrong:
 *
 *  1. **Error codes.** The whole body sat in a try/catch that rethrew everything
 *     as 500, so 404 / 400 / 403 all reached the client as a server error.
 *  2. **Idempotency.** A replayed verify used to create a second Subscribed
 *     document and expire the first.
 *  3. **Amount and order binding.** The captured amount is compared against the
 *     paise figure frozen on the transaction, and the payment's order_id against
 *     ours, so a short payment cannot activate a plan.
 *  4. **Invoice failures no longer eat the payment.**
 */
exports.verifySubscribeTransaction = async (actor, payload) => {
  const {
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
    transactionId,
  } = payload;

  const transaction = await Transaction.findById(transactionId);
  if (!transaction || transaction.isDeleted) {
    throwError(404, "Transaction not found!");
  }
  if (transaction.gateway !== PAYMENT_GATEWAYS.RAZORPAY) {
    throwError(422, "This transaction was not created through Razorpay.");
  }
  if (transaction.razorpayOrderId !== razorpayOrderId) {
    throwError(422, "This payment does not belong to the given transaction.");
  }

  const isAdmin = actor.role === ROLES.ADMIN;
  if (!isAdmin && String(transaction.createdBy) !== String(actor.userId)) {
    throwError(403, "You are not authorized to verify this payment request");
  }

  // Fast path for an obvious replay — including one the webhook already
  // settled. The authoritative guard is the conditional claim inside the shared
  // settlement; this only avoids a pointless gateway round trip.
  if (transaction.verified) {
    const existing = transaction.subscribedId
      ? await Subscribed.findById(transaction.subscribedId)
      : await getActiveSubscription(transaction.brandId);
    return {
      subscribed: existing,
      transaction,
      alreadyVerified: true,
      invoiceUrl: transaction.invoiceUrl || null,
    };
  }

  const expectedSignature = generateRazorpaySignature(
    razorpayOrderId,
    razorpayPaymentId,
    ROLES.VENDOR,
  );
  if (expectedSignature !== razorpaySignature) {
    throwError(400, "Invalid signature. Payment may be tampered.");
  }

  let payment;
  try {
    payment = await getPaymentDetails(razorpayPaymentId, ROLES.VENDOR);
  } catch (error) {
    console.error("[verifySubscribe] Razorpay lookup failed:", error?.message);
    throwError(503, "Razorpay services unavailable! Please try again later");
  }
  if (!payment) {
    throwError(503, "Razorpay services unavailable! Please try again later");
  }

  const result = await settleSubscriptionPayment({
    transaction,
    payment,
    actor,
    source: isAdmin
      ? SUBSCRIPTION_SOURCE.ADMIN_PAYMENT
      : SUBSCRIPTION_SOURCE.PAYMENT,
  });

  return {
    ...result,
    // The webhook may have won the race and settled it first — still a success.
    alreadyVerified: result.alreadySettled,
  };
};
