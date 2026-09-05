const mongoose = require("mongoose");
const Transaction = require("../../models/Transaction");
const RefundRequest = require("../../models/RefundRequest");
const WebhookEvent = require("../../models/WebhookEvent");
const Dispute = require("../../models/Dispute");
const VoucherClaim = require("../../models/VoucherClaim");
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
const { REFUND_REQUEST_STATUS } = require("../../constants/refund");
const { throwError } = require("../../utils");
const {
  verifyRazorpayWebhook,
  recordRejectedWebhook,
} = require("../../helpers/transactions");
const { releasePromoCode } = require("../../helpers/promoCodes");
const { applyRefundCompletion } = require("../../helpers/refunds");
const { recordFundsReceived } = require("../../helpers/transactions");
const LedgerEntry = require("../../models/LedgerEntry");
const { LEDGER_ENTRY_TYPE } = require("../../constants/ledger");
const {
  postChargebackLoss,
  postChargebackReversal,
} = require("../../helpers/ledger");
const { taintSettlement } = require("../../helpers/settlements");
const { recordDispute, summariseDisputes } = require("../../helpers/disputes");
const { getRazorpayAccount } = require("../../configs/razorpay");
const {
  notifyAdmins,
  sendQuietly,
  notifyVendorDisputeRaised,
  notifyVendorDisputeResolved,
  ADMIN_PATHS,
  adminUrl,
  deepLink,
} = require("../../helpers/notifications");
/**
 * ⚠️ Deadlines in an admin alert go through the shared formatter, in IST.
 *
 * `new Date(dispute.respond_by * 1000).toLocaleDateString("en-IN")` printed a
 * bare date in the **server's** zone, on the one deadline that forfeits the money
 * when it passes. See `helpers/notifications/formatDateTime.js`.
 */
const { formatDateTime } = require("../../helpers/notifications/formatDateTime");
const { formatMoney } = require("../../helpers/subscribeds");
const {
  RAZORPAY_ACCOUNTS,
  ACCOUNT_FOR_PURPOSE,
} = require("../../constants/transaction");
const { WEBHOOK_RETENTION } = require("../../constants/webhook");
const { resolveSettler, SETTLER_PURPOSES } = require("./webhookSettlers");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a RECEIVED row may sit before another delivery may take it over.
 *
 * A RECEIVED row means a request is *in flight*, not that work is pending —
 * falling through on it would race two settlers on one payment. But a process
 * that died mid-processing leaves the row RECEIVED forever, so after this long
 * it is treated as abandoned and one taker is allowed to claim it.
 */
const STALE_IN_FLIGHT_MS = 2 * 60 * 1000;

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

/**
 * Find the transaction a delivery belongs to, **scoped to the account it
 * arrived on**.
 *
 * Razorpay order ids are globally unique, so in practice the account clause
 * changes nothing. It is there because "in practice" is not a guarantee worth
 * betting a settlement on: without it, one account's payment could be matched
 * to the other account's order, and the only thing standing between that and a
 * wrong activation would be the amount check.
 */
const findTransaction = async ({
  razorpayOrderId,
  razorpayPaymentId,
  account,
}) => {
  const accountClause = account ? { gatewayAccount: account } : {};

  if (razorpayOrderId) {
    const byOrder = await Transaction.findOne({
      razorpayOrderId,
      ...accountClause,
      gateway: PAYMENT_GATEWAYS.RAZORPAY,
      isDeleted: false,
    });
    if (byOrder) return byOrder;
  }
  if (razorpayPaymentId) {
    return Transaction.findOne({
      razorpayPaymentId,
      ...accountClause,
      isDeleted: false,
    });
  }
  return null;
};

/**
 * Decide what a duplicate-key collision on `eventId` actually means.
 *
 * It used to mean one thing — "Razorpay is redelivering something we already
 * did" — and the branch answered DUPLICATE + 200 without reading the stored
 * row. That was safe only while every row under a given id had been processed.
 * It is not safe any more, because a delivery can now collide with a row that
 * is FAILED (processing threw, and Razorpay's retry is the recovery), or
 * RECEIVED (a concurrent request is in flight right now).
 *
 * Answering 200 to a FAILED row throws away the retry that would have fixed it;
 * falling through on a RECEIVED row races two settlers on one payment. So the
 * status is read and each case is answered on its own terms.
 *
 * @returns {Promise<{ proceed: boolean, record?: object, outcome?: string }>}
 */
const claimExistingDelivery = async (eventId) => {
  const existing = await WebhookEvent.findOneAndUpdate(
    { eventId },
    { $inc: { attempts: 1 } },
    { returnDocument: "after" },
  );

  // Vanished between the failed insert and this read. Nothing sensible to do
  // but acknowledge; Razorpay will not send it again.
  if (!existing) {
    return { proceed: false, outcome: "Duplicate delivery — no stored row." };
  }

  switch (existing.status) {
    case WEBHOOK_STATUS.PROCESSED:
    case WEBHOOK_STATUS.IGNORED:
    case WEBHOOK_STATUS.DUPLICATE:
      return {
        proceed: false,
        outcome: "Already processed — duplicate delivery ignored.",
      };

    // Unreachable: a rejected row is keyed on a hash of its body under a
    // REJECTED: namespace, so it cannot occupy a real event id. If it ever is
    // reached the namespacing has broken, which is worth knowing about — but
    // the delivery in hand is verified, so it is still processed.
    case WEBHOOK_STATUS.REJECTED:
      console.error(
        `[razorpayWebhook] a verified delivery collided with a REJECTED row (${eventId}) — the rejected-key namespace has broken.`,
      );
      return { proceed: true, record: existing };

    // The previous attempt threw. This redelivery is exactly the retry that
    // recovers it. Safe: the settlement claims the transaction conditionally on
    // `verified: false`, so an already-settled one reports that instead of
    // activating twice.
    case WEBHOOK_STATUS.FAILED:
      return { proceed: true, record: existing };

    // RECEIVED means a request is IN FLIGHT, not that work is pending. Taking
    // over would run two settlers on one payment. Only an abandoned row — old,
    // and never finished — may be claimed, and the conditional update makes
    // sure exactly one taker wins that race.
    case WEBHOOK_STATUS.RECEIVED:
    default: {
      const staleBefore = new Date(Date.now() - STALE_IN_FLIGHT_MS);
      const claimed = await WebhookEvent.findOneAndUpdate(
        {
          _id: existing._id,
          status: WEBHOOK_STATUS.RECEIVED,
          processedAt: null,
          createdAt: { $lte: staleBefore },
        },
        { $set: { status: WEBHOOK_STATUS.RECEIVED, processedAt: null } },
        { returnDocument: "after" },
      );

      if (claimed) return { proceed: true, record: claimed };

      return {
        proceed: false,
        outcome:
          "A delivery of this event is already being processed — this copy was ignored.",
      };
    }
  }
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
const processWebhookEvent = async ({
  record,
  event,
  ids,
  account,
  /**
   * The raw payload. Needed only by the settlement branch: `extract()` pulls
   * the payment, order, refund and dispute entities, and deliberately not the
   * settlement one — a settlement event is about a *batch*, not one payment.
   */
  body,
  isReplay = false,
}) => {
  const finish = async (status, outcome, extra = {}) => {
    const terminal = status !== WEBHOOK_STATUS.RECEIVED;
    await WebhookEvent.updateOne(
      { _id: record._id },
      {
        $set: {
          status,
          outcome,
          processedAt: new Date(),
          // Retention is decided when the delivery reaches a terminal state.
          // A row with no `expiresAt` is never swept, so an in-flight one is
          // never at risk of vanishing mid-processing.
          ...(terminal
            ? {
                expiresAt: new Date(
                  Date.now() + WEBHOOK_RETENTION.PROCESSED_DAYS * DAY_MS,
                ),
              }
            : {}),
          ...extra,
        },
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

  /**
   * ⚠️ Handled **before** the transaction lookup, and deliberately.
   *
   * A settlement event is not about one payment — it is Razorpay telling us that
   * a **batch** of them has reached our bank. `findTransaction` would find
   * nothing and the event would be dismissed as "nothing of ours", which is
   * exactly the event a vendor payout is waiting on.
   */
  if (event === RAZORPAY_WEBHOOK_EVENTS.SETTLEMENT_PROCESSED) {
    return handleGatewaySettlement({ body, account, finish });
  }

  const transaction = await findTransaction({ ...ids, account });
  if (!transaction) {
    // Anything not opened by us lands here — and, until the account clause was
    // added, a payment on the *other* account did too. Not an error: just
    // nothing of ours to settle.
    return finish(
      WEBHOOK_STATUS.IGNORED,
      `No ${account || "matching"} transaction for order ${ids.razorpayOrderId || ids.razorpayPaymentId || "?"}.`,
    );
  }

  if (!record.transactionId) {
    await WebhookEvent.updateOne(
      { _id: record._id },
      {
        $set: {
          transactionId: transaction._id,
          brandId: transaction.brandId,
          // Recorded now so the admin worklist can separate subscription
          // deliveries from voucher ones without a join.
          purpose: transaction.purpose,
        },
      },
    );
  }

  // ---------------- authorized (NOT captured) ----------------
  // Handled before the settlers, and deliberately never routed into one.
  //
  // `payment.authorized` fires on virtually every successful payment, moments
  // before the capture. The settler's first money check is `payment.captured`,
  // so sending this event there would take the not-captured branch on every
  // single payment: release the promo hold, page admins CRITICAL, and mark the
  // delivery FAILED — right before the real capture arrived and settled it.
  //
  // So this only records. The signal worth acting on is a payment that *stays*
  // authorized: auto-capture is a per-account dashboard setting, and with it off
  // Razorpay auto-refunds after about five days while the customer believes
  // they have paid. `alertStuckAuthorizations` (Phase 1B) watches for that.
  if (event === RAZORPAY_WEBHOOK_EVENTS.PAYMENT_AUTHORIZED) {
    await Transaction.updateOne(
      { _id: transaction._id, verified: false },
      {
        $set: {
          authorizedAt: new Date(),
          ...(ids.payment?.status ? { status: ids.payment.status } : {}),
        },
      },
    );
    return finish(
      WEBHOOK_STATUS.PROCESSED,
      "Authorization recorded. Waiting for capture — no settlement attempted.",
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

    // Which money flow this is. Never guessed: an unknown purpose is a hard
    // stop, because running the wrong settler on a money row is unrecoverable
    // in a way that a FAILED delivery is not.
    const settle = resolveSettler(transaction.purpose);
    if (!settle) {
      await notifyAdmins({
        type: NOTIFICATION_TYPES.WEBHOOK_FAILED,
        severity: NOTIFICATION_SEVERITY.CRITICAL,
        title: `No settlement path for a captured payment`,
        body: `Transaction ${transaction.invoiceId || transaction._id} has purpose "${transaction.purpose}", which has no settler. The money is captured and nothing has been activated. Known purposes: ${SETTLER_PURPOSES.join(", ")}.`,
        deepLink: deepLink(ADMIN_PATHS.transaction(transaction._id)),
        mail: {
          lines: [
            ["Invoice", transaction.invoiceId || "-"],
            ["Purpose", transaction.purpose || "-"],
            ["Gateway account", transaction.gatewayAccount || "-"],
            ["Razorpay order", transaction.razorpayOrderId || "-"],
            ["Known purposes", SETTLER_PURPOSES.join(", ")],
          ],
          ctaLabel: "Open transaction",
          ctaUrl: adminUrl(ADMIN_PATHS.transaction(transaction._id)),
        },
        meta: {
          transactionId: transaction._id,
          purpose: transaction.purpose,
          gatewayAccount: transaction.gatewayAccount,
          razorpayOrderId: transaction.razorpayOrderId,
          webhookEventId: record._id,
        },
        dedupeKey: `NO_SETTLER:${transaction._id}`,
      });
      return finish(
        WEBHOOK_STATUS.FAILED,
        `No settlement path for purpose "${transaction.purpose}" — admins notified. Replay once a settler exists.`,
      );
    }

    const result = await settle({
      transaction,
      payment: ids.payment,
      // No user behind a webhook; settlement falls back to the order's creator.
      actor: {},
      source: SUBSCRIPTION_SOURCE.PAYMENT,
    });

    return finish(
      WEBHOOK_STATUS.PROCESSED,
      result.alreadySettled
        ? result.doubleCapture
          ? "Already settled — and this is a SECOND captured payment. Admins notified; it needs refunding."
          : "Already settled by the client callback — no second activation."
        : `Settled (${result.action || transaction.purpose}).${isReplay ? " Recovered by replay." : ""}`,
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

  // ---------------- refunds ----------------
  //
  // All three events are handled. `refund.created` and `refund.failed` used to
  // be in the enum but in no branch at all, so a failed refund fell through
  // silently — the customer's money never arrived, the request still said
  // PROCESSING, and nothing anywhere said so.
  if (
    event === RAZORPAY_WEBHOOK_EVENTS.REFUND_CREATED ||
    event === RAZORPAY_WEBHOOK_EVENTS.REFUND_PROCESSED ||
    event === RAZORPAY_WEBHOOK_EVENTS.REFUND_FAILED
  ) {
    return handleRefundEvent({ event, ids, transaction, finish });
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

    /**
     * ⚠️ The dispute gets its **own row**, and the transaction gets a summary.
     *
     * These fields used to be `$set` straight onto the transaction, which works
     * for exactly one dispute per payment — and Razorpay does not promise one. A
     * chargeback escalating to pre-arbitration and then arbitration arrives as
     * separate disputes with separate ids, amounts and **deadlines**, and each
     * one silently replaced the last. A response deadline that disappears is an
     * automatic loss with nothing to show for it.
     *
     * `recordDispute` also settles out-of-order delivery, which the ledger's own
     * notes warn about: a late `lost` after a `won` must not win.
     */
    await recordDispute({
      transaction,
      dispute,
      status: disputeStatus,
      // Razorpay stamps the event in unix seconds. Its time, not ours — ours is
      // when the delivery happened to arrive, which is the thing being reordered.
      eventAt: body?.created_at ? new Date(body.created_at * 1000) : new Date(),
    });

    const summary = await summariseDisputes(transaction._id);

    await Transaction.updateOne(
      { _id: transaction._id },
      {
        $set: {
          ...summary,
          /**
           * ⚠️ Ineligibility is **monotonic**, and it is `settlementHold` that
           * carries it — never `isDisputed`.
           *
           * `isDisputed` tracks whether a dispute is *live*, so it correctly
           * goes back to `false` once every dispute on the payment is resolved.
           * Settlement must not key on that: a chargeback we **lost** would flip
           * the row back to fully eligible, and the next payout would hand the
           * vendor money Trydood no longer has. That is not a race — it is what
           * happens every single time.
           *
           * So every dispute event, resolved or not, puts the hold on. A webhook
           * never takes it off: releasing it is an explicit admin action, taken
           * once somebody has decided who bears the loss.
           *
           * Written **after** the summary spread, so it cannot be overwritten by
           * it.
           */
          settlementHold: true,
          settlementHoldReason: `Chargeback ${disputeStatus} (${dispute.id})`,
        },
      },
    );

    /**
     * ⚠️ The hold above only stops a **future** claim.
     *
     * If this payment is already inside a settlement, setting `settlementHold`
     * changes nothing about it — eligibility was evaluated at build time and the
     * totals describe what was captured then. So the settlement itself is
     * flagged, and approval refuses to go through while the flag is set.
     */
    const tainted = await taintSettlement({
      transaction,
      reason: `Chargeback ${disputeStatus}`,
    });

    /**
     * ⚠️ And the ledger, which never heard about a chargeback at all.
     *
     * `CHARGEBACK` / `CHARGEBACK_REVERSAL` were in the rules table from the
     * start and nothing ever wrote one. A payment settled, paid out, then pulled
     * back by the bank left no trace anywhere — the platform absorbed the loss
     * silently and the books still showed a healthy sale.
     *
     * Booked on the **resolution**, not on `created`: while the bank is still
     * deciding, nothing has moved. `ledger_type_dispute_unique` keeps it to one
     * row per dispute, which matters because Razorpay redelivers these and sends
     * them out of order.
     */
    if (disputeStatus === DISPUTE_STATUS.LOST) {
      await postChargebackLoss({
        transaction,
        disputeId: dispute.id,
        amount: amount || undefined,
      });
    } else if (disputeStatus === DISPUTE_STATUS.WON) {
      /**
       * Only reverses a loss that was actually booked. A `won` arriving with no
       * prior `lost` finds nothing to credit and writes nothing — rather than
       * handing the vendor money nobody ever took.
       */
      const booked = await LedgerEntry.findOne({
        entryType: LEDGER_ENTRY_TYPE.CHARGEBACK,
        disputeId: dispute.id,
        isDeleted: false,
      })
        .select("amount")
        .lean();

      if (booked?.amount > 0) {
        await postChargebackReversal({
          transaction,
          disputeId: dispute.id,
          amount: booked.amount,
        });
      }
    }

    // A dispute has a response deadline and missing it forfeits the money, so
    // this has to reach a human rather than sit in the webhook log.
    if (isOpen || tainted.tainted) {
      const respondBy = dispute.respond_by
        ? formatDateTime(new Date(dispute.respond_by * 1000))
        : "unknown";
      await notifyAdmins({
        type: NOTIFICATION_TYPES.PAYMENT_DISPUTED,
        severity: NOTIFICATION_SEVERITY.CRITICAL,
        title: tainted.tainted
          ? `Chargeback on settlement ${tainted.settlement.settlementNumber || tainted.settlement._id} — ${formatMoney(amount)}`
          : `Chargeback ${disputeStatus.toLowerCase().replace("_", " ")} — ${formatMoney(amount)}`,
        /**
         * ⚠️ Names the settlement when there is one.
         *
         * The old alert named only the transaction, so the admin about to
         * approve a settlement had no way to connect the two — and approved it.
         * The settlement number is the thing they are looking at.
         */
        body: tainted.tainted
          ? `A dispute landed on a payment already inside settlement ${tainted.settlement.settlementNumber || tainted.settlement._id}. ` +
            `That settlement is now on hold for revalidation — rebuild it before approving. ` +
            `Evidence must be submitted to Razorpay by ${respondBy}.`
          : `A dispute was raised on transaction ${transaction.invoiceId || transaction._id}. Evidence must be submitted to Razorpay by ${respondBy}, or the dispute is lost automatically.`,
        meta: {
          transactionId: transaction._id,
          brandId: transaction.brandId,
          settlementId: tainted.settlement?._id,
          settlementNumber: tainted.settlement?.settlementNumber,
          disputeId: dispute.id,
          disputeStatus,
          amount,
          respondBy: dispute.respond_by
            ? new Date(dispute.respond_by * 1000)
            : null,
          reason: dispute.reason_code || dispute.reason,
        },
        deepLink: deepLink(ADMIN_PATHS.dispute(transaction._id)),
        dedupeKey: `PAYMENT_DISPUTED:${dispute.id}:${disputeStatus}`,
        mail: {
          lines: [
            ["Amount", formatMoney(amount)],
            ["Respond by", respondBy],
            ["Reason", dispute.reason_code || dispute.reason || "-"],
            ["Invoice", transaction.invoiceId || "-"],
            ...(tainted.tainted
              ? [["Settlement", tainted.settlement.settlementNumber || "-"]]
              : []),
          ],
          /**
           * Two buttons when a settlement is involved, because there are two
           * things to do and they are on different screens: file the evidence
           * against the dispute, and rebuild the settlement that is now on hold.
           */
          actions: [
            {
              label: "Open dispute",
              url: adminUrl(ADMIN_PATHS.dispute(transaction._id)),
            },
            ...(tainted.tainted
              ? [
                  {
                    label: "Open settlement",
                    url: adminUrl(
                      ADMIN_PATHS.settlement(tainted.settlement._id),
                    ),
                  },
                ]
              : []),
          ],
          footnote:
            "Submit evidence from the Razorpay dashboard before the deadline.",
        },
      });
    }

    /**
     * ⚠️ And the vendor, who until now was told **nothing at all**.
     *
     * A dispute landed, the payment quietly stopped appearing in any settlement,
     * and weeks later a statement carried "Less: chargebacks recovered" with no
     * sale attached to it. From the outlet's side that is money taken without
     * explanation — however correct the arithmetic was.
     *
     * Sent from the stored row rather than the webhook payload, because
     * `recordDispute` may have **refused** this event as stale (an out-of-order
     * `lost` after a `won`). Telling a vendor they lost a dispute we actually won
     * would be worse than telling them nothing.
     */
    const stored = await Dispute.findOne({ disputeId: dispute.id }).lean();

    if (stored) {
      // The code the counter recognises. `invoiceId` is on the payment, but a
      // claim code is what an outlet can actually look up.
      const claim = transaction.voucher?.claimId
        ? await VoucherClaim.findById(transaction.voucher.claimId)
            .select("claimCode")
            .lean()
        : null;

      const isResolvedNow = [
        DISPUTE_STATUS.WON,
        DISPUTE_STATUS.LOST,
        DISPUTE_STATUS.CLOSED,
      ].includes(stored.status);

      if (!isResolvedNow && !stored.vendorNotifiedAt) {
        await sendQuietly(
          () =>
            notifyVendorDisputeRaised({
              dispute: stored,
              transaction,
              claimCode: claim?.claimCode,
            }),
          "vendor dispute raised",
        );
        /**
         * Stamped so a silent outlet reads as *silent* rather than as *never
         * asked* — two very different things when a dispute is lost and somebody
         * asks why nobody at the outlet helped.
         */
        await Dispute.updateOne(
          { _id: stored._id },
          { $set: { vendorNotifiedAt: new Date() } },
        );
      }

      if (
        stored.status === DISPUTE_STATUS.WON ||
        stored.status === DISPUTE_STATUS.LOST
      ) {
        await sendQuietly(
          () =>
            notifyVendorDisputeResolved({
              dispute: stored,
              transaction,
              claimCode: claim?.claimCode,
              won: stored.status === DISPUTE_STATUS.WON,
              /**
               * Only a payment the vendor was actually paid for can be clawed
               * back. Without it the loss is entirely ours, and telling them a
               * deduction is coming would be untrue.
               */
              recoverable: Boolean(transaction.settlementId),
            }),
          "vendor dispute resolved",
        );
      }
    }

    return finish(
      WEBHOOK_STATUS.PROCESSED,
      `Dispute ${disputeStatus} recorded for ${formatMoney(amount)}${isOpen ? " — admins notified" : ""}.`,
    );
  }

  return finish(WEBHOOK_STATUS.IGNORED, `Unhandled event "${event}".`);
};

/**
 * ⚠️ These three live at module scope, and that is load-bearing.
 *
 * They were once declared **inside** `processWebhookEvent` — a missing `};`
 * left that function spanning 585 lines and swallowing its own siblings. The
 * cost was not cosmetic: `handleGatewaySettlement` is called at the top of
 * that function and declared 160 lines below the call, so every
 * `settlement.processed` delivery threw
 *
 *     ReferenceError: Cannot access 'handleGatewaySettlement' before initialization
 *
 * from the temporal dead zone. The caller catches and records a FAILED
 * webhook, then answers Razorpay 200 — so it never retried and nothing
 * surfaced it. `recordFundsReceived` never ran, `fundsReceivedAt` stayed null
 * on every payment, and `buildEligibilityFilter` requires it to be set: no
 * settlement was ever built and no vendor was ever paid.
 *
 * `handleRefundEvent` was nested too and worked only by the luck of being
 * declared above its call site.
 */

/**
 * Razorpay has moved a batch of payments into our bank.
 *
 * ### Why a vendor payout waits for this
 *
 * `verifiedAt` says the customer paid. It does **not** say the money is ours to
 * pay out — Razorpay holds it for its own cycle and then settles the batch. In
 * between, the money exists on a dashboard and nowhere else. A T+3 rule computed
 * from `verifiedAt` is a *guess* that the gateway will have settled by then, and
 * the times it is wrong are the worst ones: an account under review, a batch held
 * over a bank holiday, a payment flagged for KYC.
 *
 * ### The payload does not carry the payments
 *
 * `settlement.processed` gives the settlement entity — id, amount, fees — and no
 * list of what is in it. That has to be fetched. Doing it here rather than in a
 * job keeps the common case one round trip; when the fetch fails the event is
 * recorded as `FAILED` so the webhook worklist and a replay can pick it up,
 * rather than the money silently never becoming eligible.
 */
const handleGatewaySettlement = async ({ body, account, finish }) => {
  const settlement = body?.payload?.settlement?.entity || null;
  if (!settlement?.id) {
    return finish(WEBHOOK_STATUS.IGNORED, "Settlement event carried no entity.");
  }

  const settledAt = settlement.created_at
    ? new Date(settlement.created_at * 1000)
    : new Date();

  let paymentIds = [];
  try {
    const { instance } = getRazorpayAccount(account);
    /**
     * The payments in this batch. `count` is capped at 100 per page by Razorpay,
     * so this pages until it runs out — a busy day settles more than 100.
     */
    let skip = 0;
    for (;;) {
      const page = await instance.payments.all({
        settlement_id: settlement.id,
        count: 100,
        skip,
      });
      const items = page?.items || [];
      paymentIds.push(...items.map((p) => p.id).filter(Boolean));
      if (items.length < 100) break;
      skip += items.length;
    }
  } catch (error) {
    /**
     * Recorded as a failure rather than swallowed. Without the payment list
     * nothing becomes eligible, and a silently-ignored event would mean a
     * vendor's payout never arrives with nothing anywhere saying why.
     */
    return finish(
      WEBHOOK_STATUS.FAILED,
      `Could not list payments for settlement ${settlement.id}: ${
        error?.error?.description || error?.message || "unknown error"
      }`,
    );
  }

  const result = await recordFundsReceived({
    settlementId: settlement.id,
    settledAt,
    paymentIds,
  });

  return finish(
    WEBHOOK_STATUS.PROCESSED,
    `Settlement ${settlement.id}: ${paymentIds.length} payment(s) in the batch, ` +
      `${result.updated} of ours marked as received.`,
  );
};

/**
 * Every refund event Razorpay sends, in one place.
 *
 * ### Matching the request
 *
 * By `razorpayRefundId` first — the executor stored it — and by the note we
 * stamped on the refund second, which covers a refund created before we managed
 * to save the id. If neither matches, the refund was issued from the Razorpay
 * dashboard by hand: the payment is still updated so the money is recorded, but
 * no request is invented for it.
 */
const handleRefundEvent = async ({ event, ids, transaction, finish }) => {
  const refund = ids.refund || {};
  const thisRefund = (refund.amount ?? 0) / 100;

  /**
   * The **cumulative** figure, straight from the payment entity.
   *
   * ⚠️ The old branch wrote `$set: { amountRefunded: thisRefundsAmount }`. Two
   * partial refunds and the second overwrote the first — ₹300 then ₹200
   * reported ₹200, and the ₹310 still owed to the vendor was invisible.
   * `payment.amount_refunded` is the running total Razorpay itself holds, which
   * survives redelivery, out-of-order delivery and dashboard refunds alike.
   */
  const gatewayTotalRefunded =
    ids.payment?.amount_refunded !== undefined
      ? ids.payment.amount_refunded / 100
      : undefined;

  const request = await findRefundRequest(refund, transaction);

  if (event === RAZORPAY_WEBHOOK_EVENTS.REFUND_CREATED) {
    // Nothing has moved yet — Razorpay has only accepted it. Recorded so a
    // refund created in the dashboard is visible to us before it settles.
    if (request) {
      await RefundRequest.updateOne(
        { _id: request._id, status: { $ne: REFUND_REQUEST_STATUS.COMPLETED } },
        {
          $set: {
            status: REFUND_REQUEST_STATUS.PROCESSING,
            razorpayRefundId: refund.id,
            isOpen: true,
          },
        },
      );
    }
    return finish(
      WEBHOOK_STATUS.PROCESSED,
      `Refund of ${formatMoney(thisRefund)} accepted by Razorpay${
        request ? "" : " (no matching request — raised outside Trydood)"
      }.`,
    );
  }

  if (event === RAZORPAY_WEBHOOK_EVENTS.REFUND_FAILED) {
    if (request) {
      /**
       * ⚠️ Conditional on the money not having landed yet.
       *
       * This was an unguarded `updateOne` on `_id` alone, and Razorpay's refund
       * events are neither ordered nor delivered once. A late or redelivered
       * `refund.failed` arriving after `refund.processed` walked a **COMPLETED**
       * refund back to `FAILED` and set `isOpen: true` — so a refund the
       * customer had already received reappeared on the admin worklist as one
       * that still had to be paid. The obvious next click sends it twice.
       *
       * `COMPLETED` is authoritative: it is only ever written by
       * `applyRefundCompletion`, which is driven by the gateway's own
       * confirmation. A failure notice cannot outrank it.
       */
      const marked = await RefundRequest.findOneAndUpdate(
        {
          _id: request._id,
          status: {
            $in: [
              REFUND_REQUEST_STATUS.PROCESSING,
              REFUND_REQUEST_STATUS.ADMIN_APPROVED,
              REFUND_REQUEST_STATUS.ADMIN_OVERRIDE,
              // Already failed: a redelivery refreshes the reason, harmlessly.
              REFUND_REQUEST_STATUS.FAILED,
            ],
          },
        },
        {
          $set: {
            status: REFUND_REQUEST_STATUS.FAILED,
            failedAt: new Date(),
            failureReason:
              refund.error_description ||
              refund.status_reason ||
              "Razorpay could not complete the refund",
            // Still open, and the hold stays on: the money has not gone back.
            isOpen: true,
          },
        },
        { returnDocument: "after" },
      ).lean();

      if (!marked) {
        return finish(
          WEBHOOK_STATUS.IGNORED,
          `A refund.failed arrived for a request that is already ${request.status} — ` +
            `ignored rather than re-opening a refund whose money has landed.`,
        );
      }
    }
    /**
     * ⚠️ This event had no branch at all before. A failed refund fell through
     * as `IGNORED`: the customer's money never arrived, the request still said
     * PROCESSING, and nothing anywhere said otherwise until somebody asked.
     */
    return finish(
      WEBHOOK_STATUS.PROCESSED,
      `Refund of ${formatMoney(thisRefund)} FAILED at Razorpay. The money has not gone back — an admin has to retry it.`,
    );
  }

  // ---------------- processed ----------------
  if (request) {
    const result = await applyRefundCompletion({
      refundRequest: request,
      gatewayTotalRefunded,
      utr: refund?.acquirer_data?.arn,
    });

    if (!result.applied) {
      return finish(
        WEBHOOK_STATUS.PROCESSED,
        "Refund already recorded; nothing to do (redelivery).",
      );
    }

    return finish(
      WEBHOOK_STATUS.PROCESSED,
      `Refund of ${formatMoney(thisRefund)} completed${
        result.isFullyRefunded ? " (full)" : " (partial)"
      }. ${result.ledger.posted} ledger row(s) posted.`,
    );
  }

  /**
   * No request behind it — somebody refunded from the Razorpay dashboard.
   *
   * The payment is still brought up to date, because the money genuinely moved
   * and a settlement must not pay a vendor for it. What is deliberately **not**
   * done is inventing a `RefundRequest`: a record with no customer behind it
   * would make every refund report wrong about who asked for what.
   */
  const cumulative =
    gatewayTotalRefunded !== undefined
      ? gatewayTotalRefunded
      : (transaction.amountRefunded || 0) + thisRefund;
  const fullyRefunded = cumulative >= (transaction.paidAmount ?? 0) - 0.005;

  const fullyRefundedAt = (transaction.paidAmount ?? 0) - 0.005;

  /**
   * ⚠️ One pipeline, so the flags cannot disagree with the amount.
   *
   * `$max` beside a plain `$set` is not atomic in meaning: `$max` refuses to
   * walk the total backwards while the `$set` next to it happily rewrites
   * `isRefunded` from whatever *this* delivery carried. An out-of-order or
   * duplicated refund event then marks a fully refunded payment `PARTIAL` — and
   * since settlement eligibility keys on `isRefunded`, that puts it straight
   * back into a payout run. Same shape as the bug fixed in
   * `applyRefundCompletion`; this path had its own copy.
   */
  await Transaction.updateOne(
    { _id: transaction._id },
    [
      {
        $set: {
          amountRefunded: {
            $max: [{ $ifNull: ["$amountRefunded", 0] }, cumulative],
          },
        },
      },
      {
        $set: {
          refundStatus: {
            $cond: [
              { $gte: ["$amountRefunded", fullyRefundedAt] },
              REFUND_STATUS.COMPLETED,
              REFUND_STATUS.PARTIAL,
            ],
          },
          isRefunded: { $gte: ["$amountRefunded", fullyRefundedAt] },
          paidRefundAt: "$$NOW",
          // Every refund landing puts a hold on, not just one we filed. This is
          // what covers a dashboard refund and Razorpay's own auto-refund.
          settlementHold: true,
          settlementHoldReason: "Refunded outside Trydood",
        },
      },
    ],
    { updatePipeline: true },
  );

  /**
   * ⚠️ And the settlement, because the hold above does nothing on its own.
   *
   * `settlementHold` only filters payments **before** they are claimed. A refund
   * raised in the Razorpay dashboard against a payment already sitting in a
   * built settlement would set the hold, change nothing, and let the payout go
   * out for money that has already gone back to the customer.
   */
  await taintSettlement({
    transaction,
    reason: "Refunded outside Trydood",
  });

  // A subscription is deliberately left alone. Revoking access on a refund is a
  // business decision with vendor-facing consequences, so it goes through
  // PUT /subscribeds/admin/cancel rather than happening silently here.
  return finish(
    WEBHOOK_STATUS.PROCESSED,
    `Refund of ${formatMoney(thisRefund)} recorded${
      fullyRefunded ? " (full)" : " (partial)"
    } with no matching request — raised outside Trydood.`,
  );
};

/**
 * Find the request a Razorpay refund belongs to.
 *
 * The stored id first; the note we stamped second, which is what covers a
 * refund created before the executor managed to save the id.
 */
const findRefundRequest = async (refund, transaction) => {
  if (refund?.id) {
    const byId = await RefundRequest.findOne({
      razorpayRefundId: refund.id,
      isDeleted: false,
    }).lean();
    if (byId) return byId;
  }

  const noteId = refund?.notes?.refundRequestId;
  if (noteId && mongoose.isValidObjectId(noteId)) {
    const byNote = await RefundRequest.findOne({
      _id: noteId,
      transactionId: transaction._id,
      isDeleted: false,
    }).lean();
    if (byNote) return byNote;
  }

  return null;
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
  // Which account this ROUTE belongs to. The account is a property of the
  // endpoint, not of whichever secret happened to verify — if the same secret
  // string were ever configured on both dashboards, deriving it from the match
  // would send every customer payment to the vendor lookup.
  account: expectedAccount,
  sourceIp,
}) => {
  const event = body?.event || "unknown";
  const ids = extract(body);

  const check = verifyRazorpayWebhook(rawBody, signature, {
    expect: expectedAccount,
  });

  if (!check.ok) {
    // Recorded BEFORE the throw. Previously nothing was written at all, so a
    // webhook secret that was wrong or not yet deployed produced captured
    // payments with no trace anywhere — the failure was completely invisible.
    // The row is keyed on a hash of the body, not on the untrusted event-id
    // header, so it cannot poison the dedupe key the genuine retry will use.
    const rejected = await recordRejectedWebhook({
      rawBody,
      account: expectedAccount,
      event,
      claimedEventId: eventId,
      sourceIp,
      reason: check.reason,
    });

    console.error(
      `[razorpayWebhook] rejected on the ${expectedAccount} route (attempt ${rejected.attempts || 1}):`,
      check.reason,
    );

    // Still a 4xx: this is the one case that must not be acknowledged, so
    // Razorpay keeps retrying while the secret is being fixed.
    throwError(400, `Webhook signature verification failed. ${check.reason}`);
  }

  const account = check.account;

  // Verified against the *other* account's secret — the dashboard is pointed at
  // the wrong URL. Process it anyway (the delivery is authentic and the money
  // is real) but say so loudly, or a misconfiguration silently works forever
  // and breaks the day the secrets diverge.
  if (expectedAccount && !check.matchedExpected) {
    await notifyAdmins({
      type: NOTIFICATION_TYPES.WEBHOOK_FAILED,
      severity: NOTIFICATION_SEVERITY.WARNING,
      title: `Razorpay webhook delivered to the wrong endpoint`,
      body: `A ${account} account delivery ("${event}") arrived on the ${expectedAccount} webhook URL. It was processed, but the ${account} dashboard should point at /transactions/webhook/razorpay${account === RAZORPAY_ACCOUNTS.CUSTOMER ? "/customer" : ""}.`,
      meta: { event, expectedAccount, actualAccount: account, ...ids },
      /**
       * The webhook **list**, not one event: nothing is wrong with this delivery
       * — it was processed. What is wrong is a dashboard setting, and the list is
       * where the pattern of misrouted deliveries is visible.
       */
      deepLink: deepLink(ADMIN_PATHS.WEBHOOKS),
      mail: {
        lines: [
          ["Event", event || "-"],
          ["Arrived on", `${expectedAccount} endpoint`],
          ["Signed by", `${account} account`],
          [
            "Should point at",
            `/transactions/webhook/razorpay${account === RAZORPAY_ACCOUNTS.CUSTOMER ? "/customer" : ""}`,
          ],
        ],
        ctaLabel: "Open webhook log",
        ctaUrl: adminUrl(ADMIN_PATHS.WEBHOOKS),
        footnote:
          "Fix the endpoint in the Razorpay dashboard for that account — this delivery was processed, but the misconfiguration breaks the day the two secrets diverge.",
      },
      dedupeKey: `WEBHOOK_MISROUTE:${expectedAccount}:${account}`,
    });
  }

  // A stable id even when the header is missing, so dedupe still works.
  const resolvedEventId =
    eventId ||
    `${event}:${ids.razorpayPaymentId || ids.razorpayOrderId || "unknown"}:${body?.created_at || ""}`;

  let record;
  try {
    record = await WebhookEvent.create({
      provider: WEBHOOK_PROVIDERS.RAZORPAY,
      eventId: resolvedEventId,
      claimedEventId: eventId,
      event,
      status: WEBHOOK_STATUS.RECEIVED,
      account,
      matchedExpectedAccount: check.matchedExpected,
      razorpayOrderId: ids.razorpayOrderId,
      razorpayPaymentId: ids.razorpayPaymentId,
      sourceIp,
      payload: body,
    });
  } catch (error) {
    if (error?.code === 11000) {
      const takeover = await claimExistingDelivery(resolvedEventId);
      if (!takeover.proceed) {
        return {
          received: true,
          event,
          status: WEBHOOK_STATUS.DUPLICATE,
          outcome: takeover.outcome,
        };
      }
      record = takeover.record;
    } else {
      throw error;
    }
  }

  try {
    return await processWebhookEvent({ record, event, ids, account, body });
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
      // The stored payload, because replaying it is the whole remedy.
      deepLink: deepLink(ADMIN_PATHS.webhook(record._id)),
      mail: {
        lines: [
          ["Event", event || "-"],
          ["Error", error?.message || "-"],
          ["Razorpay order", ids.razorpayOrderId || "-"],
          ["Razorpay payment", ids.razorpayPaymentId || "-"],
          ["Event id", String(resolvedEventId || "-")],
        ],
        ctaLabel: "Open webhook & replay",
        ctaUrl: adminUrl(ADMIN_PATHS.webhook(record._id)),
        footnote:
          "Razorpay will not retry this — it already has our 200. The stored payload is the only way back in.",
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
