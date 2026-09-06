const Transaction = require("../../models/Transaction");
const VoucherClaim = require("../../models/VoucherClaim");
const VoucherUsage = require("../../models/VoucherUsage");
const RefundRequest = require("../../models/RefundRequest");
const { REFUND_STATUS } = require("../../constants");
const {
  VOUCHER_CLAIM_STATUS,
  CLAIM_HISTORY_ACTION,
} = require("../../constants/voucherClaim");
const { REFUND_REQUEST_STATUS } = require("../../constants/refund");
const { postRefundEntries } = require("../ledger");
const { recordClaimHistory } = require("../voucherClaims");
const { sendQuietly, notifyClaimRefunded } = require("../notifications");
const { releaseConsumedPromoOnRefund } = require("../promoCodes");
const { getCustomerConfig } = require("../settings");
// Siblings, not the barrel: the barrel re-exports this file too.
const { releaseSettlementHold } = require("./releaseSettlementHold");
const { issueRefundDocument } = require("./issueRefundDocument");

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Everything that changes when a refund actually lands.
 *
 * One function, called from one place — the `refund.processed` webhook — because
 * the alternative is six call sites that each remember five of the six things.
 *
 * ### Every step is idempotent, because the webhook is redelivered
 *
 * Razorpay resends `refund.processed`. The conditional claim on the request's
 * status decides who does the work, and everything after it is safe to run
 * again: `$max` on the cumulative total, `$set` on the claim, an upsert-shaped
 * usage reversal, and a ledger poster guarded by its own unique index.
 *
 * ### The cumulative total comes from the payment, not from this refund
 *
 * ⚠️ The old handler wrote `$set: { amountRefunded: thisRefundsAmount }`. Two
 * partial refunds and the second overwrote the first — a payment refunded ₹300
 * then ₹200 reported ₹200, and the ₹310 still owed to the vendor was invisible.
 *
 * Razorpay sends the payment entity alongside the refund, and it carries
 * `amount_refunded`: the running total **it** holds. Taking that with `$max`
 * makes the field monotonic and correct under redelivery, out-of-order
 * delivery, and refunds issued by hand in the dashboard — none of which an
 * `$inc` survives.
 *
 * @param {object} args
 * @param {object} args.refundRequest      the request being completed
 * @param {number} [args.gatewayTotalRefunded] `payment.amount_refunded / 100`
 * @param {string} [args.utr]              bank reference from the refund entity
 * @param {object} [args.actor]            who triggered it; a webhook has none
 */
exports.applyRefundCompletion = async ({
  refundRequest,
  gatewayTotalRefunded,
  utr,
  actor = {},
}) => {
  /**
   * ⚠️ The payment's cumulative total is raised **before** the request is
   * closed, and that order is the point.
   *
   * Closing first opened a window: `isOpen` went false, freeing the
   * `(transactionId, isOpen)` slot, while `amountRefunded` was still the old
   * figure. A request raised in that gap was sized against a stale ceiling — a
   * ₹300 refund that had just completed could be followed by one for the full
   * ₹811.80, because as far as the ceiling check could see, nothing had gone
   * back yet.
   *
   * Doing it first costs nothing: `$max` is idempotent, and the figure comes
   * from the gateway rather than from this delivery, so raising it for a refund
   * whose claim we then lose is still the correct value.
   */
  const early = await Transaction.findById(refundRequest.transactionId)
    .select("paidAmount amount amountRefunded")
    .lean();

  const earlyCumulative =
    gatewayTotalRefunded !== undefined && gatewayTotalRefunded !== null
      ? round2(gatewayTotalRefunded)
      : round2(
          (early?.amountRefunded || 0) + (refundRequest.split?.totalRefund || 0),
        );

  if (early && earlyCumulative > 0) {
    await Transaction.updateOne({ _id: refundRequest.transactionId }, [
      {
        $set: {
          amountRefunded: {
            $max: [{ $ifNull: ["$amountRefunded", 0] }, earlyCumulative],
          },
        },
      },
    ], { updatePipeline: true });
  }

  /**
   * The conditional claim. `status` is in the filter, so a redelivered webhook
   * loses here and does no work at all.
   */
  const claimed = await RefundRequest.findOneAndUpdate(
    {
      _id: refundRequest._id,
      status: {
        $in: [
          REFUND_REQUEST_STATUS.PROCESSING,
          // A refund can complete without us ever marking it PROCESSING — an
          // admin issuing one from the Razorpay dashboard, for instance.
          REFUND_REQUEST_STATUS.ADMIN_APPROVED,
          REFUND_REQUEST_STATUS.ADMIN_OVERRIDE,
          /**
           * ⚠️ `FAILED` too, because the gateway is the authority on whether
           * money moved and we are not.
           *
           * Our request goes `FAILED` when the API call to Razorpay threw —
           * which includes a timeout, and a timeout is not an answer. Razorpay
           * may well have created and processed the refund. When
           * `refund.processed` then arrives, refusing to claim it meant the
           * customer had their money while we recorded a failure: the claim
           * never moved to `REFUNDED`, the once-per-user slot stayed held, no
           * ledger row was written, and the webhook reported success.
           */
          REFUND_REQUEST_STATUS.FAILED,
        ],
      },
    },
    {
      $set: {
        status: REFUND_REQUEST_STATUS.COMPLETED,
        completedAt: new Date(),
        isOpen: false,
        ...(utr ? { utr } : {}),
        failureReason: null,
      },
    },
    { returnDocument: "after" },
  ).lean();

  if (!claimed) {
    /**
     * Somebody already completed it — the redelivery doing its job.
     *
     * ⚠️ But it does not simply return, because the conditional claim is spent
     * **before** the ledger is written. A throw anywhere in between — a dropped
     * connection, a validation error, the process dying — used to lose the
     * refund's ledger reversal for good: the request said `COMPLETED`, every
     * redelivery bounced off this guard, and nothing else posts those rows.
     * `reconcileSettlementLedger` only audits payouts, so nothing would ever
     * notice the books were short a reversal.
     *
     * Re-posting is safe by construction: `ledger_type_refund_unique` makes
     * each entry idempotent, so this writes nothing when the rows are already
     * there and fills the gap when they are not. Only the ledger is repeated —
     * the notifications and the claim's own state belong to whoever won the
     * claim.
     */
    const done = await RefundRequest.findById(refundRequest._id).lean();

    if (done?.status === REFUND_REQUEST_STATUS.COMPLETED) {
      const [transaction, claim] = await Promise.all([
        Transaction.findById(done.transactionId).lean(),
        VoucherClaim.findById(done.claimId).lean(),
      ]);

      const repaired = await postRefundEntries({
        transaction,
        claim,
        split: done.split || {},
        refundRequest: done,
      });

      if (repaired.posted) {
        console.warn(
          `[applyRefundCompletion] re-posted ${repaired.posted} ledger row(s) for ` +
            `refund ${done._id} — a previous run completed the request and lost them.`,
        );
      }

      return {
        applied: false,
        reason: "ALREADY_COMPLETED",
        ledgerRepaired: repaired.posted,
      };
    }

    return { applied: false, reason: "ALREADY_COMPLETED" };
  }

  const [transaction, claim] = await Promise.all([
    Transaction.findById(claimed.transactionId).lean(),
    VoucherClaim.findById(claimed.claimId).lean(),
  ]);

  const split = claimed.split || {};
  const paidAmount = transaction?.paidAmount ?? transaction?.amount ?? 0;

  /**
   * Prefer the gateway's own running total; fall back to adding this refund on.
   *
   * The fallback is only reached when the payment entity was not in the payload,
   * and it is still monotonic because of the `$max` below.
   */
  const cumulative = round2(
    gatewayTotalRefunded !== undefined && gatewayTotalRefunded !== null
      ? gatewayTotalRefunded
      : (transaction?.amountRefunded || 0) + (split.totalRefund || 0),
  );

  const fullyRefundedAt = round2(paidAmount) - 0.005;

  /**
   * ⚠️ One aggregation-pipeline update, so every derived field is computed from
   * the **stored** total rather than from the one this delivery happened to
   * carry.
   *
   * The old shape was `$max` on the number beside a plain `$set` on the flags,
   * and those disagree the moment two `refund.processed` deliveries arrive out
   * of order: `$max` correctly refuses to walk ₹810 back to ₹300, while the
   * `$set` beside it happily rewrote `isRefunded` to `false` and `refundStatus`
   * to `PARTIAL`. A fully refunded payment then read as partly refunded — and
   * with the eligibility change below, that would put it back into a payout run.
   *
   * Inside a pipeline the second stage sees the first stage's result, so the
   * flags and the amount can never disagree.
   */
  await Transaction.updateOne({ _id: claimed.transactionId }, [
    {
      $set: {
        // Monotonic under redelivery and out-of-order delivery alike.
        amountRefunded: {
          $max: [{ $ifNull: ["$amountRefunded", 0] }, cumulative],
        },
      },
    },
    {
      $set: {
        /**
         * ⚠️ `PARTIAL` is the state that did not exist before this phase.
         * Writing `COMPLETED` for a ₹300 refund on an ₹810 payment made the row
         * read as fully refunded: settlement skipped it and the balance still
         * owed to the vendor was invisible.
         */
        refundStatus: {
          $cond: [
            { $gte: ["$amountRefunded", fullyRefundedAt] },
            REFUND_STATUS.COMPLETED,
            REFUND_STATUS.PARTIAL,
          ],
        },
        isRefunded: { $gte: ["$amountRefunded", fullyRefundedAt] },
        paidRefundAt: "$$NOW",
        latestRefundRequestId: claimed._id,
        /**
         * On by default, and taken off below only for a **partial** refund.
         *
         * For a full refund it stays: the money is gone and it was never the
         * vendor's to be paid.
         */
        settlementHold: true,
        settlementHoldReason: `Refunded (${claimed._id})`,
      },
    },
  ],
    /**
     * ⚠️ Mongoose 9 refuses an array update without this, and the error names
     * the option rather than the reason: an array is ambiguous between a
     * pipeline and a mistake, so it makes you say which.
     */
    { updatePipeline: true },
  );

  /**
   * Read back rather than trusting `cumulative`.
   *
   * `$max` may have kept a larger total than this delivery carried — an earlier,
   * bigger refund arriving late — and everything below branches on whether the
   * payment is *now* fully refunded, not on what this one message said.
   */
  const settled = await Transaction.findById(claimed.transactionId)
    .select("amountRefunded isRefunded")
    .lean();

  const isFullyRefunded = !!settled?.isRefunded;

  /**
   * ### ⚠️ A partial refund must not freeze the rest of the vendor's sale
   *
   * The hold used to stay on for **every** completed refund, with the note "the
   * money is gone; it was never the vendor's to be paid". True of a full refund.
   * On a ₹300 refund against an ₹810 payment it stranded the vendor's remaining
   * ₹500 out of every future settlement, for ever and silently — while the
   * refund's clawback was *also* deducted from a later cycle. The vendor was
   * docked roughly ₹1,100 on an ₹800 sale.
   *
   * So a partial refund releases, and the settlement then pays the row net of
   * the clawback (`claimRefundAdjustments` claims the refund alongside it).
   * `releaseSettlementHold` still refuses if a chargeback or another open refund
   * is holding the same payment — this asks, it does not overrule.
   */
  if (!isFullyRefunded) {
    await releaseSettlementHold({
      transactionId: claimed.transactionId,
      exceptRequestId: claimed._id,
      reason: `Partial refund completed (${claimed._id}); remainder still owed to the vendor`,
    });
  }

  /**
   * The claim only changes state on a **full** refund.
   *
   * A partially refunded claim is still a claim that happened — the customer
   * ate, the outlet served them, and part of the money came back. Marking it
   * `REFUNDED` would erase a sale that mostly took place.
   */
  if (isFullyRefunded && claim) {
    await VoucherClaim.updateOne(
      { _id: claim._id },
      {
        $set: {
          status: VOUCHER_CLAIM_STATUS.REFUNDED,
          refundedAt: new Date(),
          refundAmount: cumulative,
          refundReason: claimed.reason,
          /**
           * ⚠️ The once-per-user slot goes back.
           *
           * Without this the customer is told *"you have already used this
           * offer"* for an offer they paid for and did not get. It is the
           * single most annoying way for this flow to be wrong, and it is
           * invisible from our side.
           */
          holdsUsageSlot: false,
        },
      },
    );

    await VoucherUsage.updateMany(
      { voucherClaimId: claim._id, isReversed: { $ne: true } },
      {
        $set: {
          isReversed: true,
          reversedAt: new Date(),
          reversalReason: `Refunded (${claimed._id})`,
        },
      },
    );

    /**
     * The promo code, only if the setting says so.
     *
     * `refund.releasePromoOnRefund` is `false` by default and that default is
     * the right one for a campaign budget: a customer who claims, refunds, and
     * claims again on the same code has spent our promo money twice for one
     * sale. Switching it on is a decision about being generous, not about
     * correctness.
     *
     * Inside the full-refund branch on purpose — a partial refund leaves the
     * customer holding part of what the promo discounted, so the code was
     * genuinely used.
     */
    const config = await getCustomerConfig();
    if (config.refund?.releasePromoOnRefund) {
      await releaseConsumedPromoOnRefund({
        transactionId: claimed.transactionId,
        reason: `Refunded (${claimed._id})`,
      });
    }
  }

  const ledger = await postRefundEntries({
    transaction,
    claim,
    split,
    refundRequest: claimed,
  });

  await recordClaimHistory({
    claimId: claimed.claimId,
    customerId: claimed.customerId,
    brandId: claimed.brandId,
    transactionId: claimed.transactionId,
    action: CLAIM_HISTORY_ACTION.REFUNDED,
    role: actor.role,
    performedBy: actor.userId,
    performedByRole: actor.role ? undefined : "SYSTEM",
    amount: split.totalRefund,
    fromStatus: claim?.status,
    toStatus: isFullyRefunded ? VOUCHER_CLAIM_STATUS.REFUNDED : claim?.status,
    reason: claimed.reason,
    snapshot: {
      requestId: claimed._id,
      split,
      utr: utr || claimed.utr,
      cumulative,
      isFullyRefunded,
      ledger: { posted: ledger.posted, duplicates: ledger.duplicates },
    },
  });

  /**
   * ---------------- the document ----------------
   *
   * Issued here and nowhere earlier: the number is allotted when the money has
   * actually reached the customer, so a refund that failed at the gateway cannot
   * burn one out of a document-of-record series.
   *
   * Before the notification, deliberately — the email carries the download link,
   * and a link to a document that does not exist yet is worse than no link.
   * `issueRefundDocument` never throws and is idempotent, so a redelivered
   * webhook neither fails the completion nor allots a second number.
   */
  const documented = await issueRefundDocument({
    refundRequest: claimed,
    claim,
    transaction,
    utr: utr || claimed.utr,
  });
  const withDocument = documented || claimed;

  /**
   * The one the customer is actually waiting for, and it carries the UTR —
   * the reference they quote to their own bank when the money has not landed —
   * plus the refund document itself.
   */
  if (claim) {
    await sendQuietly(
      () =>
        notifyClaimRefunded({
          claim,
          transaction,
          amount: split.totalRefund,
          reference: utr || claimed.utr,
          refundRequest: withDocument,
        }),
      "customer claim refunded",
    );
  }

  return {
    applied: true,
    isFullyRefunded,
    cumulative,
    ledger,
    request: withDocument,
  };
};
