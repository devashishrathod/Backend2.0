const crypto = require("crypto");
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
  notifySubscriptionActivated,
  ADMIN_PATHS,
  adminUrl,
  deepLink,
} = require("../notifications");
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_SEVERITY,
} = require("../../constants/notification");
const {
  buildInvoiceSnapshot,
  detectDoubleCapture,
} = require("../transactions");
const { generateDocumentNumber } = require("../documents");
const { invoiceUrl } = require("../notifications/panelLinks");
const { DOCUMENT_KIND, DOCUMENT_SERIES } = require("../../constants/document");
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
 * @returns {{ subscribed, transaction, action, invoiceId, invoiceDownloadUrl,
 *             invoiceUrl, alreadySettled, limits }}
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
  // `let`, because the document stage below re-reads it after stamping the
  // number and the snapshot onto it.
  let claimed = await Transaction.findOneAndUpdate(
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
      invoiceDownloadUrl: invoiceUrl(settled?.documentToken),
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

  const { subscribed, sync, notice } = await activateSubscription({
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

  /**
   * ---------------- the invoice (never blocks activation) ----------------
   *
   * **Only the number and the snapshot.** The PDF renders on the first download
   * request instead — the same rule the claim side already follows. Rendering and
   * uploading one on every subscription does not survive scale, and most invoices
   * are never opened.
   *
   * ### ⚠️ Why the number is allotted *here* and not at order time
   *
   * It used to be minted inside `createSubscribeOrder`, beside the Razorpay
   * order. So a vendor who opened checkout and walked away **burned an invoice
   * number** — and an abandoned cart is the common case, not the rare one. The
   * series ended up with more holes than entries, which is precisely what a
   * GST document-of-record sequence may not have.
   *
   * Allotted at settle, the series only advances when money actually moves.
   *
   * Idempotent through the `$exists: false` guard, so a resume cannot burn a
   * second number on a transaction that already has one — which would leave the
   * gap this ordering exists to prevent.
   */
  try {
    if (!claimed.invoiceId) {
      const [config, billing] = await Promise.all([
        getSubscriptionConfig(),
        buildBillingDetails(brand),
      ]);

      const documentNumber = await generateDocumentNumber({
        series: DOCUMENT_SERIES[DOCUMENT_KIND.SUBSCRIPTION],
      });

      const invoiceSnapshot = buildInvoiceSnapshot({
        transaction: claimed,
        subscription,
        pricing: claimed.pricing,
        config,
        billing,
        validity,
        paymentMethod: claimed.paymentMethod,
        documentNumber,
      });

      // Conditional on the number still being absent, so two racing writers
      // cannot both allot one.
      const numbered = await Transaction.findOneAndUpdate(
        { _id: claimed._id, invoiceId: { $exists: false } },
        {
          $set: {
            invoiceId: documentNumber,
            invoiceSnapshot,
            /**
             * The unguessable handle for the public download link.
             *
             * ⚠️ Vendors never had one. The customer side has minted a token
             * since it was written, so a claim receipt could be opened from an
             * email or a WhatsApp message; a subscription invoice could only be
             * reached through a raw storage URL that could not be revoked and was
             * never sent anywhere. `GET /transactions/invoice/:token` served both
             * kinds all along — nothing was ever putting a token on this half.
             */
            documentToken: crypto.randomBytes(32).toString("hex"),
          },
        },
        { returnDocument: "after" },
      );
      if (numbered) claimed = numbered;
    }
  } catch (error) {
    /**
     * The money is captured and the plan is live, so this must not throw — but it
     * must not be swallowed either.
     *
     * It used to be a bare `console.error`, which meant a vendor with a paid
     * subscription and no invoice was a fact nobody learned until they asked.
     * The alert is deduped, so a retry storm does not become a mail storm.
     */
    console.error(
      `[settleSubscriptionPayment] invoice failed for transaction ${claimed._id}:`,
      error?.message,
    );

    /**
     * ⚠️ Nested `try`, and it is load-bearing.
     *
     * `notifyAdmins` goes through `notifyAudience`, which never throws for a
     * delivery failure but **does** propagate an invalid or oversized audience —
     * deliberately, so a caller's mistake is not swallowed. Here that guarantee
     * points the wrong way: this runs after the money is captured and the plan is
     * live, so an exception escaping would fail a settlement that actually
     * succeeded, and the client would be told the payment failed.
     *
     * Losing the alert is bad. Failing the settlement to deliver it is worse.
     */
    try {
      await notifyAdmins({
        type: NOTIFICATION_TYPES.WEBHOOK_FAILED,
        severity: NOTIFICATION_SEVERITY.WARNING,
        title: `Invoice could not be issued for ${brand.brandName || brand.legalBusinessName || "a vendor"}`,
        body:
          `The payment settled and the plan is live, but the invoice number or snapshot could not be written. ` +
          `The vendor has a paid subscription with no invoice. Re-issue it from the transaction.`,
        meta: {
          transactionId: claimed._id,
          brandId: brand._id,
          subscriptionId: subscription._id,
          reason: error?.message,
        },
        dedupeKey: `INVOICE_FAILED:${claimed._id}`,
        deepLink: deepLink(ADMIN_PATHS.transaction(claimed._id)),
        mail: {
          lines: [
            ["Brand", brand.brandName || brand.legalBusinessName || "-"],
            ["Plan", subscription.name || "-"],
            ["Amount", String(claimed.paidAmount ?? "-")],
            ["Reason", error?.message || "-"],
          ],
          ctaLabel: "Open transaction",
          ctaUrl: adminUrl(ADMIN_PATHS.transaction(claimed._id)),
          footnote:
            "Nothing is broken for the vendor — the plan is active. They simply have no invoice until it is re-issued.",
        },
      });
    } catch (alertError) {
      console.error(
        `[settleSubscriptionPayment] could not raise the invoice-failure alert for ${claimed._id}:`,
        alertError?.message,
      );
    }
  }

  // The invoice number and snapshot are frozen (or the failure raised and moved
  // past — a missing document is a re-issue problem, not a settlement failure).
  await Transaction.updateOne(
    { _id: claimed._id },
    { $set: { settlementStage: SETTLEMENT_STAGE.INVOICED } },
  );

  /**
   * ---------------- tell the vendor ----------------
   *
   * After the document stage, deliberately: the notice carries the invoice number
   * and the Download Invoice button, and neither exists until the block above has
   * run. Sent from inside `activateSubscription` — where it used to live — it went
   * out with a blank number and no link.
   *
   * `notify` never throws, so a mail outage cannot leave a settled payment marked
   * incomplete and retried forever.
   */
  await notifySubscriptionActivated({ ...notice, transaction: claimed });

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
    transaction: claimed.toObject(),
    action,
    /**
     * ⚠️ `null` at settle time now, and that is the point: the PDF is rendered
     * on the first download rather than eagerly here. `invoiceDownloadUrl` is
     * what a caller should hand the vendor — the token link, which renders the
     * document on demand and caches it afterwards.
     */
    invoiceUrl: claimed.invoiceUrl || null,
    invoiceDownloadUrl: invoiceUrl(claimed.documentToken),
    invoiceId: claimed.invoiceId || null,
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
