const Transaction = require("../../models/Transaction");
const WebhookEvent = require("../../models/WebhookEvent");
const {
  RAZORPAY_WEBHOOK_EVENTS,
  WEBHOOK_HANDLED_EVENTS,
  WEBHOOK_STATUS,
  WEBHOOK_PROVIDERS,
  DISPUTE_EVENT_STATUS,
  DISPUTE_STATUS,
} = require("../../constants/webhook");
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_SEVERITY,
} = require("../../constants/notification");
const {
  PAYMENT_GATEWAYS,
  SUBSCRIPTION_SOURCE,
} = require("../../constants/subscription");
const { REFUND_STATUS } = require("../../constants");
const { throwError } = require("../../utils");
const { verifyRazorpayWebhook } = require("../../helpers/transactions");
const { settleSubscriptionPayment } = require("../../helpers/subscribeds");
const { releasePromoCode } = require("../../helpers/promoCodes");
const { notifyAdmins } = require("../../helpers/notifications");
const { formatMoney } = require("../../helpers/subscribeds");

/** Pull the payment / refund / dispute entity out of Razorpay's nested payload. */
const extract = (body) => {
  const payment = body?.payload?.payment?.entity || null;
  const order = body?.payload?.order?.entity || null;
  const refund = body?.payload?.refund?.entity || null;
  const dispute = body?.payload?.dispute?.entity || null;
  return {
    payment,
    order,
    refund,
    dispute,
    razorpayOrderId:
      payment?.order_id || order?.id || refund?.payment_id || null,
    razorpayPaymentId:
      payment?.id || refund?.payment_id || dispute?.payment_id || null,
  };
};

const findTransaction = async ({ razorpayOrderId, razorpayPaymentId }) => {
  if (razorpayOrderId) {
    const byOrder = await Transaction.findOne({
      razorpayOrderId,
      gateway: PAYMENT_GATEWAYS.RAZORPAY,
      isDeleted: false,
    });
    if (byOrder) return byOrder;
  }
  if (razorpayPaymentId) {
    return Transaction.findOne({ razorpayPaymentId, isDeleted: false });
  }
  return null;
};

/**
 * Act on a stored webhook event.
 *
 * Split out from the receiving endpoint so a **replay** runs the exact same
 * logic. The receiver establishes authenticity (HMAC) and stores the delivery;
 * this decides what it means. A replay skips only the signature step — the
 * payload was already proven authentic when it was first stored, and the caller
 * is an authenticated admin.
 *
 * Idempotency lives one level down, in `settleSubscriptionPayment`'s conditional
 * claim on `verified: false`, so re-running a captured event cannot activate a
 * second subscription.
 *
 * @returns {{ status: string, outcome: string }}
 */
const processWebhookEvent = async ({ record, event, ids, isReplay = false }) => {
  const finish = async (status, outcome, extra = {}) => {
    await WebhookEvent.updateOne(
      { _id: record._id },
      {
        $set: { status, outcome, processedAt: new Date(), ...extra },
        // Cleared on a successful re-run so the row does not keep an error from
        // an attempt that has since been resolved.
        ...(status === WEBHOOK_STATUS.PROCESSED ? { $unset: { error: "" } } : {}),
      },
    );
    return { received: true, event, status, outcome };
  };

  if (!WEBHOOK_HANDLED_EVENTS.includes(event)) {
    return finish(
      WEBHOOK_STATUS.IGNORED,
      `Event "${event}" is not one this platform acts on.`,
    );
  }

  const transaction = await findTransaction(ids);
  if (!transaction) {
    // Customer-side payments and anything not opened by us land here. Not an
    // error — just nothing of ours to settle.
    return finish(
      WEBHOOK_STATUS.IGNORED,
      `No subscription transaction matches order ${ids.razorpayOrderId || ids.razorpayPaymentId || "?"}.`,
    );
  }

  if (!record.transactionId) {
    await WebhookEvent.updateOne(
      { _id: record._id },
      { $set: { transactionId: transaction._id, brandId: transaction.brandId } },
    );
  }

  // ---------------- captured ----------------
  if (
    event === RAZORPAY_WEBHOOK_EVENTS.PAYMENT_CAPTURED ||
    event === RAZORPAY_WEBHOOK_EVENTS.ORDER_PAID
  ) {
    if (!ids.payment) {
      return finish(
        WEBHOOK_STATUS.IGNORED,
        "Event carried no payment entity to settle.",
      );
    }

    const result = await settleSubscriptionPayment({
      transaction,
      payment: ids.payment,
      // No user behind a webhook; settlement falls back to the order's creator.
      actor: {},
      source: SUBSCRIPTION_SOURCE.PAYMENT,
    });

    return finish(
      WEBHOOK_STATUS.PROCESSED,
      result.alreadySettled
        ? "Already settled by the client callback — no second activation."
        : `Subscription activated (${result.action}).${isReplay ? " Recovered by replay." : ""}`,
    );
  }

  // ---------------- failed ----------------
  if (event === RAZORPAY_WEBHOOK_EVENTS.PAYMENT_FAILED) {
    // Never touch an already-settled transaction: a later failed attempt on the
    // same order must not undo a live plan.
    if (transaction.verified) {
      return finish(
        WEBHOOK_STATUS.PROCESSED,
        "Payment failed after this order was already settled — left untouched.",
      );
    }
    await Transaction.updateOne(
      { _id: transaction._id, verified: false },
      {
        $set: {
          status: ids.payment?.status || "failed",
          errorCode: ids.payment?.error_code,
          errorDescription: ids.payment?.error_description,
          errorReason: ids.payment?.error_reason,
          errorSource: ids.payment?.error_source,
          errorStep: ids.payment?.error_step,
        },
      },
    );
    await releasePromoCode({
      transactionId: transaction._id,
      reason: "Payment failed (webhook)",
    });
    return finish(
      WEBHOOK_STATUS.PROCESSED,
      "Payment failure recorded; any promo hold released.",
    );
  }

  // ---------------- refunded ----------------
  if (event === RAZORPAY_WEBHOOK_EVENTS.REFUND_PROCESSED) {
    const refunded = (ids.refund?.amount ?? 0) / 100;
    const fullyRefunded = refunded >= (transaction.paidAmount ?? 0);
    await Transaction.updateOne(
      { _id: transaction._id },
      {
        $set: {
          amountRefunded: refunded,
          refundStatus: REFUND_STATUS.COMPLETED,
          isRefunded: fullyRefunded,
          paidRefundAt: new Date(),
        },
      },
    );
    // The subscription is deliberately left alone. Revoking access on a refund
    // is a business decision with vendor-facing consequences, so it goes through
    // PUT /subscribeds/admin/cancel rather than happening silently here.
    return finish(
      WEBHOOK_STATUS.PROCESSED,
      `Refund of ${formatMoney(refunded)} recorded${fullyRefunded ? " (full)" : " (partial)"}. Subscription left active — cancel it explicitly if intended.`,
    );
  }

  // ---------------- dispute ----------------
  const disputeStatus = DISPUTE_EVENT_STATUS[event];
  if (disputeStatus) {
    const dispute = ids.dispute || {};
    const amount = (dispute.amount ?? 0) / 100;
    const isOpen = ![
      DISPUTE_STATUS.WON,
      DISPUTE_STATUS.LOST,
      DISPUTE_STATUS.CLOSED,
    ].includes(disputeStatus);

    await Transaction.updateOne(
      { _id: transaction._id },
      {
        $set: {
          isDisputed: isOpen,
          disputeStatus,
          disputeId: dispute.id,
          disputeAmount: amount || undefined,
          disputeReason: dispute.reason_code || dispute.reason,
          disputePhase: dispute.phase,
          ...(disputeStatus === DISPUTE_STATUS.OPEN
            ? { disputedAt: new Date() }
            : {}),
          ...(dispute.respond_by
            ? { disputeRespondBy: new Date(dispute.respond_by * 1000) }
            : {}),
          ...(isOpen ? {} : { disputeResolvedAt: new Date() }),
        },
      },
    );

    // A dispute has a response deadline and missing it forfeits the money, so
    // this has to reach a human rather than sit in the webhook log.
    if (isOpen) {
      const respondBy = dispute.respond_by
        ? new Date(dispute.respond_by * 1000).toLocaleDateString("en-IN")
        : "unknown";
      await notifyAdmins({
        type: NOTIFICATION_TYPES.PAYMENT_DISPUTED,
        severity: NOTIFICATION_SEVERITY.CRITICAL,
        title: `Chargeback ${disputeStatus.toLowerCase().replace("_", " ")} — ${formatMoney(amount)}`,
        body: `A dispute was raised on transaction ${transaction.invoiceId || transaction._id}. Evidence must be submitted to Razorpay by ${respondBy}, or the dispute is lost automatically.`,
        meta: {
          transactionId: transaction._id,
          brandId: transaction.brandId,
          disputeId: dispute.id,
          disputeStatus,
          amount,
          respondBy: dispute.respond_by
            ? new Date(dispute.respond_by * 1000)
            : null,
          reason: dispute.reason_code || dispute.reason,
        },
        dedupeKey: `PAYMENT_DISPUTED:${dispute.id}:${disputeStatus}`,
        mail: {
          lines: [
            ["Amount", formatMoney(amount)],
            ["Respond by", respondBy],
            ["Reason", dispute.reason_code || dispute.reason || "-"],
            ["Invoice", transaction.invoiceId || "-"],
          ],
          footnote:
            "Submit evidence from the Razorpay dashboard before the deadline.",
        },
      });
    }

    return finish(
      WEBHOOK_STATUS.PROCESSED,
      `Dispute ${disputeStatus} recorded for ${formatMoney(amount)}${isOpen ? " — admins notified" : ""}.`,
    );
  }

  return finish(WEBHOOK_STATUS.IGNORED, `Unhandled event "${event}".`);
};

/**
 * Razorpay webhook receiver.
 *
 * Closes the gap where verification was client-driven only: a vendor who closed
 * the tab between paying and the browser calling back had their money captured
 * and no plan activated. Razorpay now tells us directly.
 *
 * Design constraints, all deliberate:
 *
 *  - **Signature over the raw body.** The endpoint is public — it cannot carry a
 *    JWT — so the HMAC is the only thing between it and anyone who knows the
 *    URL. `index.js` stashes the untouched buffer on `req.rawBody`, because
 *    re-serialised JSON will not match.
 *  - **Store, then process.** Every verified delivery is written to
 *    `WebhookEvent` before anything acts on it, so a failure is replayable and a
 *    disputed payment can be reconstructed from what the gateway actually sent.
 *  - **Idempotent per event.** `eventId` is unique, so Razorpay's retries and
 *    duplicate deliveries become no-ops rather than a second activation.
 *  - **Always 200 once the signature is valid.** Razorpay retries on any non-2xx.
 *    A payload we cannot act on — unknown order, unhandled event, an internal
 *    error — is recorded and acknowledged, otherwise it is redelivered forever.
 *    Only a *bad signature* gets a 4xx.
 */
exports.handleRazorpayWebhook = async ({
  rawBody,
  signature,
  eventId,
  body,
}) => {
  const check = verifyRazorpayWebhook(rawBody, signature);
  if (!check.ok) {
    // The one case that must not be acknowledged.
    console.error("[razorpayWebhook] rejected:", check.reason);
    throwError(400, `Webhook signature verification failed. ${check.reason}`);
  }

  const event = body?.event || "unknown";
  const ids = extract(body);

  // A stable id even when the header is missing, so dedupe still works.
  const resolvedEventId =
    eventId ||
    `${event}:${ids.razorpayPaymentId || ids.razorpayOrderId || "unknown"}:${body?.created_at || ""}`;

  let record;
  try {
    record = await WebhookEvent.create({
      provider: WEBHOOK_PROVIDERS.RAZORPAY,
      eventId: resolvedEventId,
      event,
      status: WEBHOOK_STATUS.RECEIVED,
      razorpayOrderId: ids.razorpayOrderId,
      razorpayPaymentId: ids.razorpayPaymentId,
      payload: body,
    });
  } catch (error) {
    if (error?.code === 11000) {
      // Razorpay redelivering something we already have.
      await WebhookEvent.updateOne(
        { eventId: resolvedEventId },
        { $inc: { attempts: 1 } },
      );
      return {
        received: true,
        event,
        status: WEBHOOK_STATUS.DUPLICATE,
        outcome: "Already processed — duplicate delivery ignored.",
      };
    }
    throw error;
  }

  try {
    return await processWebhookEvent({ record, event, ids });
  } catch (error) {
    // Recorded and acknowledged: a non-2xx would have Razorpay retry forever,
    // and the stored payload makes this replayable.
    console.error(
      `[razorpayWebhook] processing ${event} failed:`,
      error?.message,
    );
    await WebhookEvent.updateOne(
      { _id: record._id },
      {
        $set: {
          status: WEBHOOK_STATUS.FAILED,
          error: error?.message,
          processedAt: new Date(),
        },
      },
    );

    // Money may have been captured with no plan activated, and Razorpay will
    // not retry once it has our 200 — so this must reach a human.
    await notifyAdmins({
      type: NOTIFICATION_TYPES.WEBHOOK_FAILED,
      severity: NOTIFICATION_SEVERITY.CRITICAL,
      title: `Webhook could not be processed — ${event}`,
      body: `A verified ${event} delivery failed: ${error?.message}. The payload is stored and can be replayed once the cause is fixed.`,
      meta: {
        webhookEventId: record._id,
        eventId: resolvedEventId,
        event,
        razorpayOrderId: ids.razorpayOrderId,
        razorpayPaymentId: ids.razorpayPaymentId,
        error: error?.message,
      },
      dedupeKey: `WEBHOOK_FAILED:${resolvedEventId}`,
      mail: {
        lines: [
          ["Event", event],
          ["Order", ids.razorpayOrderId || "-"],
          ["Payment", ids.razorpayPaymentId || "-"],
          ["Error", error?.message || "-"],
        ],
        footnote:
          "Replay it with POST /transactions/webhook/replay/<eventId> once resolved.",
      },
    });

    return {
      received: true,
      event,
      status: WEBHOOK_STATUS.FAILED,
      outcome:
        "Signature verified but processing failed. The event is stored for replay and admins have been notified.",
    };
  }
};

exports.processWebhookEvent = processWebhookEvent;
exports.extractWebhookIds = extract;
