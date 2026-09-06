const Subscription = require("../../models/Subscription");
const Transaction = require("../../models/Transaction");
const { ROLES, PAYMENT_STATUS } = require("../../constants");
const {
  PAYMENT_GATEWAYS,
  SUBSCRIPTION_SOURCE,
  SUBSCRIPTION_HISTORY_ACTION,
} = require("../../constants/subscription");
const { throwError } = require("../../utils");
const { getRazorpayAccount } = require("../../configs/razorpay");
const { resolveActorBrand } = require("../../helpers/brands");
const {
  buildCheckoutPreview,
  recordSubscribedHistory,
} = require("../../helpers/subscribeds");
const {
  reservePromoCode,
  releasePromoCode,
} = require("../../helpers/promoCodes");
const { PROMO_CODE_LIMITS } = require("../../constants/promoCode");
const {
  TRANSACTION_PURPOSE,
  ACCOUNT_FOR_PURPOSE,
} = require("../../constants/transaction");

/**
 * Open a Razorpay order for a subscription purchase.
 *
 * The amount is computed server-side from the plan and the admin's tax config,
 * and the caller cannot influence it. Previously `amount` was accepted from the
 * request body and used as `amount || price`, so anyone could buy a ₹4,999 plan
 * for ₹1 — that field is gone from the validator and is not read here.
 */
exports.createSubscribeOrder = async (actor, payload) => {
  const { subscriptionId, brandId, promoCode, email, whatsappNumber } = payload;

  const brand = await resolveActorBrand(actor, brandId);

  const subscription = await Subscription.findById(subscriptionId).lean();
  if (!subscription || subscription.isDeleted) {
    throwError(404, "Subscription plan not found!");
  }
  if (!subscription.isActive) {
    throwError(422, "This subscription plan is no longer available.");
  }

  // Same builder the preview endpoint uses: identical pricing, identical gates.
  // `strictPromo` turns an unusable code into a 422 here — silently charging
  // full price on a code the vendor thinks they applied is not acceptable.
  const preview = await buildCheckoutPreview(brand, subscription, actor, {
    promoCode,
    strictPromo: true,
  });
  if (!preview.canProceed) throwError(403, preview.blockedReason);

  const { pricing, config } = preview;
  if (pricing.amountInPaise <= 0) {
    throwError(
      422,
      "This plan has no payable amount. An admin can grant it directly instead.",
    );
  }

  // Resolved once, before the reuse branch, because both exits hand the client
  // a key id and it must be the key that owns the order — a mismatch means
  // Razorpay's checkout refuses to open at all.
  const { instance: razorpay, keyId } = getRazorpayAccount(
    ACCOUNT_FOR_PURPOSE[TRANSACTION_PURPOSE.SUBSCRIPTION],
  );

  // Reuse a still-open order for the same brand + plan rather than leaving a
  // trail of abandoned Razorpay orders every time the page is reloaded.
  const reuseWindowMs = (config.pendingOrderReuseMinutes || 0) * 60 * 1000;
  if (reuseWindowMs > 0) {
    const existing = await Transaction.findOne({
      brandId: brand._id,
      subscriptionId: subscription._id,
      status: PAYMENT_STATUS.CREATED,
      gateway: PAYMENT_GATEWAYS.RAZORPAY,
      verified: false,
      isDeleted: false,
      amount: pricing.totalPayable,
      createdAt: { $gte: new Date(Date.now() - reuseWindowMs) },
      // Never hand back an order whose promo quote has lapsed — its frozen
      // discount can no longer be cleanly honoured, and reusing it would just
      // recreate the desync this window exists to prevent.
      $or: [
        { promoQuotedUntil: { $exists: false } },
        { promoQuotedUntil: null },
        { promoQuotedUntil: { $gt: new Date() } },
      ],
    }).sort({ createdAt: -1 });
    if (existing) {
      // Same shape as a fresh order so the client needs no special case.
      return {
        transaction: existing,
        plan: preview.response.plan,
        pricing,
        orderSummary: preview.response.orderSummary,
        billingDetails: preview.response.billingDetails,
        razorpay: {
          orderId: existing.razorpayOrderId,
          amount: existing.pricing?.amountInPaise ?? pricing.amountInPaise,
          currency: existing.currency,
          keyId,
        },
        reused: true,
      };
    }
  }

  const receipt = `rcpt_${brand._id.toString().slice(-6)}_${Date.now()
    .toString()
    .slice(-6)}`;

  const razorpayOrder = await razorpay.orders.create({
    amount: pricing.amountInPaise,
    currency: pricing.currency,
    receipt,
    notes: {
      brandId: brand._id.toString(),
      subscriptionId: subscription._id.toString(),
      planName: subscription.name,
    },
  });
  if (!razorpayOrder?.id) {
    throwError(503, "Razorpay services unavailable! Please try again later");
  }

  const transaction = await Transaction.create({
    // Both required. `purpose` routes the webhook to the right settler;
    // `gatewayAccount` is what every later signature check, payment lookup and
    // refund reads instead of hardcoding an account at the call site.
    purpose: TRANSACTION_PURPOSE.SUBSCRIPTION,
    gatewayAccount: ACCOUNT_FOR_PURPOSE[TRANSACTION_PURPOSE.SUBSCRIPTION],
    brandId: brand._id,
    subscriptionId: subscription._id,
    userId: brand.userId,
    createdBy: actor.userId,
    email: email || brand.email,
    contact: brand.whatsappNumber || whatsappNumber,
    gateway: PAYMENT_GATEWAYS.RAZORPAY,
    entity: razorpayOrder.entity,
    // Trust our own maths, not the echo — these must agree with what verify
    // re-derives, and Razorpay only ever returns what we asked for.
    amount: pricing.totalPayable,
    pricing,
    currency: razorpayOrder.currency || pricing.currency,
    status: razorpayOrder.status,
    razorpayOrderId: razorpayOrder.id,
    receipt: razorpayOrder.receipt,
    dueAmount: pricing.totalPayable,
    paidAmount: (razorpayOrder.amount_paid ?? 0) / 100,
    attempts: razorpayOrder.attempts,
    notes: razorpayOrder.notes,
    // Was previously written as `offer_id`, which the schema silently dropped.
    offerId: razorpayOrder.offer_id,
    /**
     * ⚠️ No `invoiceId` here, deliberately.
     *
     * It used to be allotted on this line, beside the Razorpay order — so a
     * vendor who opened checkout and walked away **burned an invoice number**,
     * and an abandoned cart is the common case rather than the rare one. The
     * subscription series ended up with more holes in it than entries, which is
     * exactly what a GST document-of-record sequence may not have.
     *
     * `settleSubscriptionPayment` allots it once the payment is captured, so the
     * series only advances when money actually moves — the same rule the voucher
     * claim side has always followed.
     */
    createdAtRaw: razorpayOrder.created_at,
  });

  // Claim the promo code now that there is a transaction to attach it to. The
  // claim is atomic, so a limited code cannot be oversold; it is released again
  // if the payment never lands, or reclaimed by the stale-reservation sweep.
  if (preview.promoVerdict?.ok) {
    try {
      // The quote stands exactly as long as the reservation does, so the two
      // cannot drift apart.
      await Transaction.updateOne(
        { _id: transaction._id },
        {
          $set: {
            promoQuotedUntil: new Date(
              Date.now() + PROMO_CODE_LIMITS.RESERVATION_TTL_MINUTES * 60 * 1000,
            ),
          },
        },
      );
      await reservePromoCode({
        promoCode: preview.promoVerdict.promoCode,
        brand,
        userId: actor.userId,
        subscription,
        transaction,
        discountAmount: preview.promoVerdict.discount,
      });
    } catch (error) {
      // The order is worthless without the discount it was priced with, so undo
      // it rather than leaving the vendor an order at the wrong amount.
      await Transaction.updateOne(
        { _id: transaction._id },
        { $set: { isDeleted: true, note: "Promo reservation failed" } },
      );
      await releasePromoCode({
        transactionId: transaction._id,
        reason: "Order rolled back",
      });
      throw error;
    }
  }

  await recordSubscribedHistory({
    brandId: brand._id,
    transactionId: transaction._id,
    action: SUBSCRIPTION_HISTORY_ACTION.ORDER_CREATED,
    performedBy: actor.userId,
    role: actor.role,
    toSubscriptionId: subscription._id,
    source:
      actor.role === ROLES.ADMIN
        ? SUBSCRIPTION_SOURCE.ADMIN_PAYMENT
        : SUBSCRIPTION_SOURCE.PAYMENT,
    amount: pricing.totalPayable,
    snapshot: {
      pricing,
      razorpayOrderId: razorpayOrder.id,
      promoCode: preview.promoVerdict?.ok
        ? preview.promoVerdict.promoCode.code
        : null,
    },
  });

  return {
    transaction,
    plan: preview.response.plan,
    pricing,
    orderSummary: preview.response.orderSummary,
    billingDetails: preview.response.billingDetails,
    razorpay: {
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      keyId,
    },
    reused: false,
  };
};
