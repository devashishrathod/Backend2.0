const Transaction = require("../../models/Transaction");
const VoucherClaim = require("../../models/VoucherClaim");

const {
  buildTransactionFilter,
  getPaymentDetails,
} = require("../../helpers/transactions");
const { releasePromoCode } = require("../../helpers/promoCodes");
const {
  settleVoucherClaimPayment,
  recordClaimHistory,
} = require("../../helpers/voucherClaims");
const { notifyAdmins } = require("../../helpers/notifications");
const { getCustomerConfig } = require("../../helpers/settings");
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_SEVERITY,
} = require("../../constants/notification");
const {
  TRANSACTION_PURPOSE,
  SETTLEMENT_STAGE,
} = require("../../constants/transaction");
const {
  VOUCHER_CLAIM_STATUS,
  CLAIM_HISTORY_ACTION,
} = require("../../constants/voucherClaim");

const MINUTE_MS = 60 * 1000;

/**
 * Reclaim the once-per-user slots held by checkouts that were never completed.
 *
 * Without this, a customer who opens a claim and walks away holds that offer's
 * slot forever — they can never use it, and nobody can tell them why.
 *
 * ### ⚠️ It asks Razorpay before it cancels anything
 *
 * The obvious version just cancels anything `PENDING` past its window. That is
 * wrong, and wrong in a way that costs money:
 *
 * A customer opens a tab, leaves it, and pays forty minutes later — or the
 * webhook is simply late. The sweep has already cancelled the claim and freed
 * the slot; by the time the payment captures, another claim may hold it, and the
 * settle then fails on a duplicate key **after the money was taken**.
 *
 * So a claim is only cancelled once Razorpay confirms nothing was captured. A
 * captured payment is left alone and allowed to settle, however late it is.
 */
exports.releaseStaleClaimHolds = async () => {
  const config = await getCustomerConfig();
  const cutoff = new Date(Date.now() - config.claim.quoteTtlMinutes * MINUTE_MS);

  /**
   * ⚠️ Bounded, and oldest first.
   *
   * This had no limit and no sort, and the loop below makes **one Razorpay call
   * per row**. A backlog — a gateway outage, a launch day, a job that was off
   * for an afternoon — turns a fifteen-minute sweep into a run of thousands of
   * sequential network calls that holds the `JobLock` for hours. Every other
   * money job then waits behind it, including the ones that repair holds.
   *
   * `createdAt: 1` drains genuinely: the oldest holds are the ones blocking a
   * customer from claiming again, and each pass permanently resolves whatever it
   * touches, so the queue shrinks rather than rotating.
   */
  const stale = await VoucherClaim.find({
    status: VOUCHER_CLAIM_STATUS.PENDING,
    isDeleted: false,
    createdAt: { $lte: cutoff },
  })
    .select("_id transactionId customerId brandId claimCode holdsUsageSlot")
    .sort({ createdAt: 1 })
    .limit(200)
    .lean();

  if (!stale.length) return { checked: 0, cancelled: 0, keptForCapture: 0 };

  let cancelled = 0;
  let keptForCapture = 0;

  for (const claim of stale) {
    const transaction = claim.transactionId
      ? await Transaction.findById(claim.transactionId)
      : null;

    /**
     * Ask the gateway, not the clock.
     *
     * A lookup failure means we do not know — and "do not know" must not become
     * "cancel it". Skipping leaves the claim for the next run, which costs
     * nothing; cancelling a paid claim costs a refund and a complaint.
     */
    if (transaction?.razorpayPaymentId) {
      try {
        const payment = await getPaymentDetails(
          transaction.razorpayPaymentId,
          transaction.gatewayAccount,
        );
        if (payment?.captured) {
          keptForCapture++;
          continue;
        }
      } catch (error) {
        console.error(
          `[releaseStaleClaimHolds] could not check ${transaction.razorpayPaymentId}:`,
          error?.message,
        );
        keptForCapture++;
        continue;
      }
    }

    // Conditional on PENDING, so a claim that settled between the read above
    // and this write is not clobbered.
    const result = await VoucherClaim.updateOne(
      { _id: claim._id, status: VOUCHER_CLAIM_STATUS.PENDING },
      {
        $set: {
          status: VOUCHER_CLAIM_STATUS.CANCELLED,
          holdsUsageSlot: false,
          cancelledAt: new Date(),
          cancelReason: "Checkout was not completed",
        },
      },
    );
    if (!result.modifiedCount) continue;

    cancelled++;

    await releasePromoCode({
      transactionId: claim.transactionId,
      reason: "Claim checkout expired",
    });
    if (claim.transactionId) {
      await Transaction.updateOne(
        { _id: claim.transactionId, verified: false },
        { $set: { isDeleted: true, note: "Claim checkout expired" } },
      );
    }
    await recordClaimHistory({
      claimId: claim._id,
      customerId: claim.customerId,
      brandId: claim.brandId,
      transactionId: claim.transactionId,
      action: CLAIM_HISTORY_ACTION.CANCELLED,
      fromStatus: VOUCHER_CLAIM_STATUS.PENDING,
      toStatus: VOUCHER_CLAIM_STATUS.CANCELLED,
      reason: "Checkout was not completed",
    });
  }

  return { checked: stale.length, cancelled, keptForCapture };
};

/**
 * Finish settlements that were claimed and then abandoned.
 *
 * The repair path for the crash this whole staged design exists for: the
 * conditional claim is terminal, so a process that dies after it leaves a
 * transaction `verified: true` with the work half done and **no way back in** —
 * verify says `alreadyVerified`, the webhook retry says `alreadySettled`.
 *
 * Every step of the settle is idempotent, so this does not need to know where it
 * stopped. It runs the whole thing again and the finished parts are no-ops.
 *
 * ### ⚠️ Scoped by BOTH purpose and the stage existing
 *
 * `settlementStage != "COMPLETE"` is true of a **missing** field, and every
 * transaction written before the field existed has none. Without the `$exists`
 * guard this job's first run would try to re-settle the entire subscription
 * history. The M10 migration marked those `COMPLETE`, so the data is clean too —
 * but a query that only works because of a migration someone remembered to run
 * is not a query worth relying on.
 */
exports.resumeIncompleteSettlements = async ({ olderThanMinutes = 5 } = {}) => {
  const cutoff = new Date(Date.now() - olderThanMinutes * MINUTE_MS);

  const now = new Date();

  /**
   * ⚠️ Ordered by how little we have tried, not by whatever Mongo returns first.
   *
   * This was a bare `.limit(50)` with no sort. A row that always throws —
   * corrupt pricing, a voucher since deleted — kept its place in natural order
   * and consumed a slot on every run. Fifty of those and the sweep spends every
   * tick failing on the same fifty while newly stranded payments are never
   * reached at all. That matters more here than anywhere else in this file:
   * this is the path that repairs a customer who was charged and got nothing.
   *
   * `settlementResumeAt` is the back-off gate and `settlementResumeAttempts` is
   * the ordering. A poisoned row is never dropped — it just stops queueing ahead
   * of a payment nobody has tried yet.
   */
  const stranded = await Transaction.find({
    ...buildTransactionFilter({
      purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
      verified: true,
    }),
    settlementStage: { $exists: true, $ne: SETTLEMENT_STAGE.COMPLETE },
    verifiedAt: { $lte: cutoff },
    $or: [
      { settlementResumeAt: { $exists: false } },
      { settlementResumeAt: null },
      { settlementResumeAt: { $lte: now } },
    ],
  })
    .sort({ settlementResumeAttempts: 1, verifiedAt: 1 })
    .limit(50);

  if (!stranded.length) return { found: 0, resumed: 0, failed: 0 };

  let resumed = 0;
  let failed = 0;

  for (const transaction of stranded) {
    try {
      await settleVoucherClaimPayment({
        transaction,
        // The payment is already recorded on the row; resume does not re-read
        // the gateway and does not re-take the conditional claim.
        payment: { captured: true, id: transaction.razorpayPaymentId },
        resume: true,
      });
      resumed++;
    } catch (error) {
      failed++;

      /**
       * Back off, so this row stops blocking the ones behind it.
       *
       * Doubling from five minutes and capped at six hours: long enough that a
       * permanently broken row costs one attempt a quarter-day, short enough
       * that a transient failure — a gateway blip, a lock contention — is
       * retried while it still matters.
       */
      const attempts = (transaction.settlementResumeAttempts || 0) + 1;
      const backoffMs = Math.min(
        5 * MINUTE_MS * 2 ** (attempts - 1),
        6 * 60 * MINUTE_MS,
      );

      await Transaction.updateOne(
        { _id: transaction._id },
        {
          $set: {
            settlementResumeAttempts: attempts,
            settlementResumeAt: new Date(Date.now() + backoffMs),
          },
        },
      );
      console.error(
        `[resumeIncompleteSettlements] ${transaction._id} failed:`,
        error?.message,
      );
    }
  }

  if (failed) {
    await notifyAdmins({
      type: NOTIFICATION_TYPES.WEBHOOK_FAILED,
      severity: NOTIFICATION_SEVERITY.CRITICAL,
      title: `${failed} voucher settlement(s) could not be resumed`,
      body:
        `Money was captured and the settlement never finished. Each of these has a ` +
        `customer who paid and a vendor who has not been credited.`,
      meta: { failed, found: stranded.length },
      dedupeKey: `RESUME_FAILED:${new Date().toISOString().slice(0, 13)}`,
    });
  }

  return { found: stranded.length, resumed, failed };
};

/**
 * Find payments the gateway took that we never heard about.
 *
 * The webhook can be lost — a bad secret, a deploy window, a delivery Razorpay
 * gave up on. The customer's browser callback can be lost too, if they closed
 * the tab. When both are lost the money is captured and nothing here knows.
 *
 * This is the net under that: any claim still `PENDING` with an order older than
 * the reuse window is checked against Razorpay directly, and settled if it was
 * in fact paid.
 */
exports.reconcileClaimPayments = async ({ olderThanMinutes = 15 } = {}) => {
  const cutoff = new Date(Date.now() - olderThanMinutes * MINUTE_MS);

  const pending = await Transaction.find({
    ...buildTransactionFilter({
      purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
      verified: false,
    }),
    razorpayOrderId: { $type: "string" },
    createdAt: { $lte: cutoff },
  }).limit(50);

  if (!pending.length) return { checked: 0, recovered: 0 };

  let recovered = 0;

  for (const transaction of pending) {
    // Nothing to look up without a payment id — the customer never got as far
    // as paying, and the stale sweep will close it.
    if (!transaction.razorpayPaymentId) continue;

    try {
      const payment = await getPaymentDetails(
        transaction.razorpayPaymentId,
        transaction.gatewayAccount,
      );
      if (!payment?.captured) continue;

      await settleVoucherClaimPayment({ transaction, payment });
      recovered++;

      await notifyAdmins({
        type: NOTIFICATION_TYPES.WEBHOOK_FAILED,
        severity: NOTIFICATION_SEVERITY.WARNING,
        title: `A captured payment was recovered by reconciliation`,
        body:
          `Payment ${payment.id} was captured but neither the webhook nor the browser ` +
          `callback settled it. It has been settled now — worth checking why the ` +
          `webhook did not arrive.`,
        meta: {
          transactionId: transaction._id,
          razorpayPaymentId: payment.id,
        },
        dedupeKey: `RECONCILED:${payment.id}`,
      });
    } catch (error) {
      console.error(
        `[reconcileClaimPayments] ${transaction._id} failed:`,
        error?.message,
      );
    }
  }

  return { checked: pending.length, recovered };
};

/**
 * Chase payments stuck in `authorized`.
 *
 * An authorized payment is money the bank has held and nobody has taken.
 * Razorpay auto-refunds it after about five days, which the customer
 * experiences as a silent failure: they were charged, they got nothing, and the
 * money quietly came back with no explanation.
 *
 * Auto-capture normally makes this impossible — which is exactly why it needs
 * watching. If this job ever fires, auto-capture is off on that account and
 * every payment is sitting in the same state.
 */
exports.alertStuckAuthorizations = async () => {
  const config = await getCustomerConfig();
  const cutoff = new Date(
    Date.now() - config.refund.authorizedAlertMinutes * MINUTE_MS,
  );

  const stuck = await Transaction.find({
    ...buildTransactionFilter({
      purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
      verified: false,
    }),
    authorizedAt: { $exists: true, $lte: cutoff },
  })
    .select("_id authorizedAt amount razorpayPaymentId customerId")
    .limit(100)
    .lean();

  if (!stuck.length) return { stuck: 0 };

  await notifyAdmins({
    type: NOTIFICATION_TYPES.WEBHOOK_FAILED,
    severity: NOTIFICATION_SEVERITY.CRITICAL,
    title: `${stuck.length} payment(s) authorized but never captured`,
    body:
      `These have been held by the bank without being taken for over ` +
      `${config.refund.authorizedAlertMinutes} minutes. Razorpay auto-refunds an ` +
      `uncaptured authorization after about five days, which the customer sees as ` +
      `a silent failure. Check that auto-capture is enabled on the CUSTOMER account.`,
    meta: {
      count: stuck.length,
      oldest: stuck[0]?.authorizedAt,
      examples: stuck.slice(0, 5).map((t) => t.razorpayPaymentId),
    },
    // One alert an hour, not one per payment — if auto-capture is off there
    // will be hundreds and they all say the same thing.
    dedupeKey: `STUCK_AUTH:${new Date().toISOString().slice(0, 13)}`,
  });

  return { stuck: stuck.length };
};
