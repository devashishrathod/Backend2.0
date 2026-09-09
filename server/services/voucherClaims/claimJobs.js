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
const {
  notifyAdmins,
  ADMIN_PATHS,
  adminUrl,
  deepLink,
  formatDateTime,
} = require("../../helpers/notifications");
const { getCustomerConfig } = require("../../helpers/settings");
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_SEVERITY,
} = require("../../constants/notification");
const { TRANSACTION_PURPOSE } = require("../../constants/transaction");
const {
  VOUCHER_CLAIM_STATUS,
  CLAIM_HISTORY_ACTION,
} = require("../../constants/voucherClaim");

const MINUTE_MS = 60 * 1000;

/**
 * ⚠️ `resumeIncompleteSettlements` used to live here, and that was the bug.
 *
 * Scoped to `purpose: VOUCHER_CLAIM` beside these three genuinely claim-specific
 * jobs, it could not see a subscription payment that stranded half-settled — so
 * that flow had no repair path at all. It now dispatches every money flow and
 * lives in `services/transactions/settlementJobs.js`, which is where to look for
 * it.
 */

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
        deepLink: deepLink(ADMIN_PATHS.transaction(transaction._id)),
        mail: {
          lines: [
            ["Razorpay payment", payment.id || "-"],
            ["Recovered at", formatDateTime(new Date())],
            ["Status", "Settled by reconciliation"],
          ],
          ctaLabel: "Open transaction",
          ctaUrl: adminUrl(ADMIN_PATHS.transaction(transaction._id)),
          footnote:
            "Nothing is owed — this is already settled. The reason the webhook never arrived is what needs looking at.",
        },
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
    deepLink: deepLink(ADMIN_PATHS.TRANSACTIONS),
    mail: {
      lines: [
        ["Stuck payments", String(stuck.length)],
        ["Oldest authorized at", formatDateTime(stuck[0]?.authorizedAt)],
        ["Alert threshold", `${config.refund.authorizedAlertMinutes} minutes`],
        [
          "Examples",
          stuck
            .slice(0, 5)
            .map((t) => t.razorpayPaymentId)
            .filter(Boolean)
            .join(", ") || "-",
        ],
      ],
      ctaLabel: "Open transactions",
      ctaUrl: adminUrl(ADMIN_PATHS.TRANSACTIONS),
      footnote:
        "If this fired at all, auto-capture is off on the CUSTOMER account and every payment is in this state.",
    },
  });

  return { stuck: stuck.length };
};
