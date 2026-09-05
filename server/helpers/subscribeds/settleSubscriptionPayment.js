const Brand = require("../../models/Brand");
const Subscription = require("../../models/Subscription");
const Transaction = require("../../models/Transaction");
const Subscribed = require("../../models/Subscribed");
const User = require("../../models/User");
const { SCREENS } = require("../../constants");
const { SUBSCRIPTION_SOURCE } = require("../../constants/subscription");
const { throwError } = require("../../utils");
const { getSubscriptionConfig } = require("../settings");
const { summarizeUsage } = require("../brands");
const { commitPromoCode, releasePromoCode } = require("../promoCodes");
const {
  notifyAdmins,
  ADMIN_PATHS,
  adminUrl,
  deepLink,
} = require("../notifications");
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_SEVERITY,
} = require("../../constants/notification");
const {
  generateAndUploadInvoice,
  buildInvoiceSnapshot,
  detectDoubleCapture,
} = require("../transactions");
const { SETTLEMENT_STAGE } = require("../../constants/transaction");
const { calculateEndDate } = require("./calculateEndDate");
const { getActiveSubscription } = require("./getActiveSubscription");
const { resolveSubscriptionAction } = require("./resolveSubscriptionAction");
const { activateSubscription } = require("./activateSubscription");
const { buildBillingDetails } = require("./buildBillingDetails");

/** Map a Razorpay payment payload onto our Transaction fields. */
const mapPayment = (payment, expectedTotal) => ({
  entity: payment.entity,
  description: payment.description,
  status: payment.status,
  paidAmount: (payment.amount ?? 0) / 100,
  dueAmount: Math.max(0, expectedTotal - (payment.amount ?? 0) / 100),
  amountRefunded: (payment.amount_refunded ?? 0) / 100,
  refundStatus: payment.refund_status,
  isInternational: payment.international,
  paymentMethod: payment.method,
  walletProvider: payment.wallet,
  fee: (payment.fee ?? 0) / 100,
  tax: (payment.tax ?? 0) / 100,
  cardId: payment.card_id,
  bank: payment.bank,
  vpa: payment.vpa,
  notes: payment.notes,
  errorCode: payment.error_code,
  errorDescription: payment.error_description,
  errorSource: payment.error_source,
  errorStep: payment.error_step,
  errorReason: payment.error_reason,
  acquirerData: payment.acquirer_data,
  updatedAtRaw: payment.created_at,
});

/**
 * Turn a captured Razorpay payment into a live subscription.
 *
 * The single settlement path, shared by the client-driven verify endpoint and
 * the webhook. Both arrive with the same thing — a payment payload whose
 * authenticity has already been established (by the per-payment HMAC in one
 * case, the webhook body signature in the other) — so the money checks,
 * activation, promo commit, invoice and screen advance all live here rather than
 * being written twice and drifting apart.
 *
 * **Race-safe against itself.** The client callback and the webhook routinely
 * arrive within milliseconds of each other. Rather than reading `verified` and
 * then writing it — which both callers would pass — the transaction is *claimed*
 * with a conditional update on `verified: false`. Exactly one caller wins and
 * performs the activation; the loser is told the plan is already live.
 *
 * @param {object} args
 * @param {object} args.transaction  the Transaction being settled
 * @param {object} args.payment      Razorpay payment payload
 * @param {object} [args.actor]      who triggered it; absent for the webhook
 * @param {string} [args.source]     SUBSCRIPTION_SOURCE for the new record
 * @returns {{ subscribed, transaction, action, invoiceUrl, alreadySettled, limits }}
 */
exports.settleSubscriptionPayment = async ({
  transaction,
  payment,
  actor = {},
  source = SUBSCRIPTION_SOURCE.PAYMENT,
}) => {
  // ---------------- money checks ----------------
  // The signature proves the payment is genuine, not that it belongs to this
  // order or that the right amount arrived.
  if (payment.order_id && payment.order_id !== transaction.razorpayOrderId) {
    throwError(422, "This payment belongs to a different order.");
  }

  const expectedPaise =
    transaction.pricing?.amountInPaise ||
    Math.round((transaction.amount || 0) * 100);
  if (Number(payment.amount) !== Number(expectedPaise)) {
    throwError(
      422,
      `Payment amount mismatch. Expected ₹${(expectedPaise / 100).toFixed(2)} but received ₹${((payment.amount || 0) / 100).toFixed(2)}. Please contact support.`,
    );
  }

  if (!payment.captured) {
    // Nothing was taken, so let the promo hold go.
    await releasePromoCode({
      transactionId: transaction._id,
      reason: `Payment not captured (${payment.status || "unknown"})`,
    });
    throwError(
      402,
      payment.error_description ||
        payment.error_reason ||
        `Payment was not captured (status: ${payment.status || "unknown"}). Please try again.`,
    );
  }

  // ---------------- claim the transaction ----------------
  // Conditional on `verified: false`, so only one of the two racing callers
  // proceeds to activate.
  const claimed = await Transaction.findOneAndUpdate(
    { _id: transaction._id, verified: false },
    {
      $set: {
        ...mapPayment(payment, transaction.amount),
        razorpayPaymentId: payment.id,
        verified: true,
        verifiedAt: new Date(),
        // The claim is terminal — nothing can re-enter through it — but several
        // dependent writes follow. This is how `resumeIncompleteSettlements`
        // finds a settlement that was claimed and then abandoned mid-way.
        settlementStage: SETTLEMENT_STAGE.CLAIMED,
      },
    },
    { returnDocument: "after" },
  );

  if (!claimed) {
    // Someone else settled it first — return what they produced.
    const settled = await Transaction.findById(transaction._id);

    // ...but "someone else" is not always the same payment. Razorpay allows
    // more than one payment attempt on an order, so this can be a genuinely
    // SECOND capture — money taken twice, with the conditional claim quietly
    // dropping it. That has to reach a human.
    const double = await detectDoubleCapture({
      transaction: settled || transaction,
      payment,
    });

    const existing = settled?.subscribedId
      ? await Subscribed.findById(settled.subscribedId)
      : await getActiveSubscription(transaction.brandId);
    return {
      subscribed: existing,
      transaction: settled,
      action: null,
      invoiceUrl: settled?.invoiceUrl || null,
      alreadySettled: true,
      doubleCapture: double.isDouble,
    };
  }

  const [brand, subscription] = await Promise.all([
    Brand.findById(claimed.brandId),
    Subscription.findById(claimed.subscriptionId).lean(),
  ]);
  if (!brand || brand.isDeleted) throwError(404, "Brand not found!");
  if (!subscription || subscription.isDeleted) {
    throwError(404, "Subscription plan not found!");
  }

  // ---------------- activate ----------------
  const active = await getActiveSubscription(brand._id);
  const currentPlan = active?.subscriptionId
    ? await Subscription.findById(active.subscriptionId).lean()
    : null;
  const { action } = resolveSubscriptionAction(
    active,
    currentPlan,
    subscription,
  );

  const startDate = new Date();
  const validity = {
    startDate,
    endDate: calculateEndDate(
      startDate,
      subscription.durationInYears,
      subscription.durationInDays,
    ),
  };

  const { subscribed, sync } = await activateSubscription({
    brand,
    subscription,
    // The webhook has no user behind it; fall back to whoever opened the order.
    actor: { userId: actor.userId || claimed.createdBy, role: actor.role },
    action,
    source,
    pricing: claimed.pricing,
    validity,
    transaction: claimed,
    paidAmount: claimed.paidAmount,
    dueAmount: claimed.dueAmount,
  });

  // The discount is now final. If the reservation had already been swept as
  // stale, this re-claims it: the money was captured at the discounted amount so
  // it must be honoured, and the ledger has to say so.
  const promoCommit = await commitPromoCode({
    transactionId: claimed._id,
    subscribedId: subscribed._id,
    pricing: claimed.pricing,
    brandId: brand._id,
    subscriptionId: subscription._id,
    userId: actor.userId || claimed.createdBy,
  });

  // Domain records are written: the plan is live and the promo is committed.
  await Transaction.updateOne(
    { _id: claimed._id },
    { $set: { settlementStage: SETTLEMENT_STAGE.RECORDED } },
  );

  const quoteLapsed = Boolean(
    claimed.promoQuotedUntil && claimed.promoQuotedUntil < new Date(),
  );

  if (promoCommit?.exceededLimit) {
    // A limited code went past its cap because a late payment had to be
    // honoured. Nothing to undo — but somebody should know.
    await notifyAdmins({
      type: NOTIFICATION_TYPES.PROMO_LIMIT_EXCEEDED,
      severity: NOTIFICATION_SEVERITY.WARNING,
      title: `Promo code ${claimed.pricing?.promoCode} went over its usage limit`,
      body: `A payment quoted before the code ran out was settled afterwards, so the discount was honoured. Redemptions are now ${promoCommit.promoCode?.usedCount} against a limit of ${promoCommit.promoCode?.totalUsageLimit}.`,
      meta: {
        promoCode: claimed.pricing?.promoCode,
        transactionId: claimed._id,
        brandId: brand._id,
        usedCount: promoCommit.promoCode?.usedCount,
        totalUsageLimit: promoCommit.promoCode?.totalUsageLimit,
      },
      dedupeKey: `PROMO_OVER_LIMIT:${claimed._id}`,
      deepLink: deepLink(ADMIN_PATHS.promo(claimed.pricing?.promoCode)),
      mail: {
        lines: [
          ["Promo code", claimed.pricing?.promoCode || "-"],
          ["Redemptions", String(promoCommit.promoCode?.usedCount ?? "-")],
          ["Limit", String(promoCommit.promoCode?.totalUsageLimit ?? "-")],
          ["Transaction", String(claimed._id)],
        ],
        ctaLabel: "Open promo code",
        ctaUrl: adminUrl(ADMIN_PATHS.promo(claimed.pricing?.promoCode)),
        footnote:
          "Nothing to undo — the payment was quoted at that price before the code ran out. Raise the cap or close the code.",
      },
    });
  }

  // ---------------- invoice (never blocks activation) ----------------
  let invoiceUrl = null;
  try {
    const [config, billing] = await Promise.all([
      getSubscriptionConfig(),
      buildBillingDetails(brand),
    ]);

    // Frozen first, then rendered from that snapshot alone. Stored even if the
    // upload then fails, so a re-issue reproduces this exact invoice rather than
    // rebuilding it from whatever is current at that later time.
    const invoiceSnapshot = buildInvoiceSnapshot({
      transaction: claimed,
      subscription,
      pricing: claimed.pricing,
      config,
      billing,
      validity,
      paymentMethod: claimed.paymentMethod,
    });
    await Transaction.updateOne(
      { _id: claimed._id },
      { $set: { invoiceSnapshot } },
    );

    invoiceUrl = await generateAndUploadInvoice(invoiceSnapshot);
    if (invoiceUrl) {
      await Transaction.updateOne(
        { _id: claimed._id },
        { $set: { invoiceUrl } },
      );
    }
  } catch (error) {
    // The money is captured and the plan is live. A missing PDF is a
    // regenerate-later problem — see POST /transactions/invoice/regenerate.
    console.error(
      `[settleSubscriptionPayment] invoice failed for transaction ${claimed._id}:`,
      error?.message,
    );
  }

  // The invoice snapshot is frozen (or its failure logged and moved past —
  // a missing PDF is a regenerate-later problem, not a settlement failure).
  await Transaction.updateOne(
    { _id: claimed._id },
    { $set: { settlementStage: SETTLEMENT_STAGE.INVOICED } },
  );

  // Only nudge the vendor forward if they are still on the subscribe step.
  await User.updateOne(
    { _id: brand.userId, currentScreen: SCREENS.SUBSCRIBE_PLAN },
    { $set: { currentScreen: SCREENS.OUTLET_PAGE } },
  );

  // Nothing left to resume.
  await Transaction.updateOne(
    { _id: claimed._id },
    { $set: { settlementStage: SETTLEMENT_STAGE.COMPLETE } },
  );

  return {
    subscribed,
    transaction: { ...claimed.toObject(), invoiceUrl },
    action,
    invoiceUrl,
    limits: summarizeUsage(
      await Brand.findById(brand._id).lean(),
      sync.entitlements,
    ),
    overflow: sync.overflow,
    // Surfaced rather than hidden: the quoted price was honoured even though the
    // promo reservation had lapsed, and the ledger was corrected to match.
    promo: claimed.pricing?.promoCode
      ? {
          code: claimed.pricing.promoCode,
          discount: claimed.pricing.promoDiscount,
          quoteLapsed,
          reconciled: Boolean(promoCommit?.reconciled),
          exceededLimit: Boolean(promoCommit?.exceededLimit),
        }
      : null,
    alreadySettled: false,
  };
};

exports.mapRazorpayPayment = mapPayment;
