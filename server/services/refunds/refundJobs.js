const RefundRequest = require("../../models/RefundRequest");
const Transaction = require("../../models/Transaction");
const { CLAIM_HISTORY_ACTION } = require("../../constants/voucherClaim");
const {
  REFUND_REQUEST_STATUS,
  REFUND_ACTOR,
} = require("../../constants/refund");
const { VENDOR_TIMEOUT_ACTIONS } = require("../../constants/customer");
const { getCustomerConfig } = require("../../helpers/settings");
const { getRazorpayAccount } = require("../../configs/razorpay");
const { applyRefundCompletion } = require("../../helpers/refunds");
const { taintSettlement } = require("../../helpers/settlements");
const { recordClaimHistory } = require("../../helpers/voucherClaims");
const {
  sendQuietly,
  notifyAdminRefundEscalated,
  notifyVendorRefundReminder,
  notifyCustomerRefundApproved,
  notifyRefundBankDetailsReminder,
  notifyAdminBankDetailsStale,
} = require("../../helpers/notifications");

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * A silent outlet cannot hold a customer's money.
 *
 * The vendor gets `refund.vendorApprovalHours` to answer. When that runs out the
 * request stops being theirs and moves on — either to an admin (`ESCALATE`) or
 * straight through (`AUTO_APPROVE`), whichever `refund.onVendorTimeout` says.
 *
 * ### Why the deadline is stored rather than computed here
 *
 * `vendorRespondBy` is written when the request is created. Computing it here
 * from `createdAt + settings` would mean raising the setting tomorrow silently
 * extends every request already waiting on today's promise — a customer told
 * "within 24 hours" would find themselves waiting 48 because of a change they
 * never saw. It also lets this query use an index instead of scanning.
 *
 * ### The hold stays on either way
 *
 * A timeout is not a rejection. The money is still owed until somebody decides,
 * so `settlementHold` is untouched — only a terminal *no* releases it.
 */
exports.escalateStaleRefunds = async () => {
  const config = await getCustomerConfig();
  const refundConfig = config.refund || {};
  const now = new Date();

  const due = await RefundRequest.find({
    status: REFUND_REQUEST_STATUS.REQUESTED,
    vendorRespondBy: { $lte: now },
    isDeleted: false,
  })
    .select("_id claimId customerId brandId transactionId claimCode requestedAmount approvedAmount vendorRespondBy")
    .limit(200)
    .lean();

  if (!due.length) return { checked: 0, escalated: 0, autoApproved: 0 };

  const autoApprove =
    refundConfig.onVendorTimeout === VENDOR_TIMEOUT_ACTIONS.AUTO_APPROVE;

  let escalated = 0;
  let autoApproved = 0;

  for (const request of due) {
    /**
     * The conditional claim again — `status` is in the filter.
     *
     * Two instances can run this at the same moment, and the job lock only
     * covers the common case. A vendor answering in the same second as the sweep
     * must not have their decision overwritten by a timeout.
     */
    const updated = await RefundRequest.findOneAndUpdate(
      { _id: request._id, status: REFUND_REQUEST_STATUS.REQUESTED },
      {
        $set: {
          status: autoApprove
            ? REFUND_REQUEST_STATUS.VENDOR_APPROVED
            : REFUND_REQUEST_STATUS.VENDOR_TIMEOUT,
          // Both are open states: the money still has to be decided on and then
          // paid.
          isOpen: true,
          ...(autoApprove
            ? {
                approvedAmount: request.approvedAmount ?? request.requestedAmount,
                vendorDecisionAt: new Date(),
              }
            : {}),
        },
      },
      { returnDocument: "after" },
    ).lean();

    if (!updated) continue;

    if (autoApprove) autoApproved += 1;
    else escalated += 1;

    await recordClaimHistory({
      claimId: request.claimId,
      customerId: request.customerId,
      brandId: request.brandId,
      transactionId: request.transactionId,
      action: CLAIM_HISTORY_ACTION.REFUND_ESCALATED,
      // No person behind a sweep. "The timeout job did it" is the real answer.
      performedByRole: REFUND_ACTOR.SYSTEM,
      reason: autoApprove
        ? "Outlet did not respond in time; approved automatically"
        : "Outlet did not respond in time; sent to Trydood for review",
      snapshot: {
        requestId: request._id,
        vendorRespondBy: request.vendorRespondBy,
        action: autoApprove ? "AUTO_APPROVE" : "ESCALATE",
      },
    });

    if (autoApprove) {
      await sendQuietly(
        () => notifyCustomerRefundApproved({ request: updated }),
        "customer refund auto-approved",
      );
    } else {
      // Nobody else can move it now, and the customer has already waited a full
      // window.
      await sendQuietly(
        () => notifyAdminRefundEscalated({ request: updated }),
        "admin refund escalated",
      );
    }
  }

  return { checked: due.length, escalated, autoApproved };
};

/**
 * Refunds that left for Razorpay and never came back.
 *
 * A `PROCESSING` request is one where the money has been asked for but no
 * terminal webhook has landed. Most of the time that means it is simply in
 * flight — bank refunds take days. It becomes a problem when the webhook was
 * **lost**: the customer has their money, the claim still says redeemed, the
 * once-per-user slot is still held, and no ledger row exists.
 *
 * So this asks Razorpay directly rather than waiting, and runs the same
 * `applyRefundCompletion` the webhook would have. Idempotent for the same
 * reason: the conditional claim on the request's status decides who does the
 * work.
 *
 * ⚠️ Reads, never writes, at the gateway. This job must not be able to *issue* a
 * refund — that is `executeRefund`'s job and it has its own double-payment
 * guards. A reconcile that could pay would be a second, unguarded path to money
 * leaving.
 */
/**
 * Put back a settlement hold that never landed.
 *
 * ⚠️ The guarantee this whole design rests on is that **an open refund's payment
 * is always held**. `requestRefund` sets the hold, but as a second round trip
 * after the request is created — a process that dies in between leaves an open
 * refund whose money is still eligible for payout. Settlement then pays the
 * vendor for a claim that is about to be refunded, and the refund has nothing to
 * come out of.
 *
 * Repaired rather than merely reported, because the window between noticing and
 * fixing is a settlement run. Idempotent: it only touches rows that are wrong.
 */
const repairMissingHolds = async () => {
  /**
   * ⚠️ The limit is applied to the **broken** rows, not to the open ones.
   *
   * This used to read the first 500 open refunds and update whichever of them
   * lacked a hold. Two things made that a permanent blind spot: there was no
   * sort, so "first 500" meant natural order; and `FAILED` is an open status
   * that nothing ever closes, so unrepairable rows pile up at the head and
   * every newer one starves behind them. A set that never drains cannot be
   * swept with a plain limit.
   *
   * Matching first and limiting after means the batch only ever contains rows
   * this run is about to fix, so the backlog genuinely shrinks.
   */
  const broken = await RefundRequest.aggregate([
    { $match: { isOpen: true, isDeleted: false } },
    {
      $lookup: {
        from: Transaction.collection.name,
        localField: "transactionId",
        foreignField: "_id",
        as: "payment",
        pipeline: [{ $project: { settlementHold: 1, settlementId: 1 } }],
      },
    },
    { $unwind: "$payment" },
    { $match: { "payment.settlementHold": { $ne: true } } },
    { $limit: 500 },
    { $project: { _id: 1, transactionId: 1, settlementId: "$payment.settlementId" } },
  ]);

  if (!broken.length) return 0;

  const result = await Transaction.updateMany(
    {
      _id: { $in: broken.map((r) => r.transactionId) },
      settlementHold: { $ne: true },
    },
    {
      $set: {
        settlementHold: true,
        settlementHoldReason: "Open refund — hold re-applied by reconcile",
      },
    },
  );

  /**
   * ⚠️ And the settlement, which the hold alone does nothing about.
   *
   * `settlementHold` is only a **pre-claim** filter. Once a payment carries a
   * `settlementId`, eligibility has already been decided and setting the hold
   * changes nothing about that settlement — so the job whose entire purpose is
   * "stop paying a vendor for a claim under refund" did not stop it. The
   * settlement has to be flagged, which is what blocks approval.
   */
  let tainted = 0;
  for (const row of broken) {
    if (!row.settlementId) continue;
    const result = await taintSettlement({
      transaction: { _id: row.transactionId, settlementId: row.settlementId },
      reason: "Open refund found on a payment already inside this settlement",
    });
    if (result.tainted) tainted += 1;
  }

  if (result.modifiedCount || tainted) {
    console.warn(
      `[reconcileRefunds] re-applied ${result.modifiedCount} settlement hold(s) ` +
        `that an open refund should already have had` +
        (tainted ? `, and flagged ${tainted} settlement(s) already holding them.` : "."),
    );
  }
  return result.modifiedCount || 0;
};

exports.reconcileRefunds = async () => {
  // Before anything else: the guarantee the rest of the design rests on.
  const holdsRepaired = await repairMissingHolds();

  const config = await getCustomerConfig();
  // Give the gateway a sensible head start before calling anything stuck.
  const graceMinutes = Number(config.refund?.authorizedAlertMinutes) || 30;
  const cutoff = new Date(Date.now() - graceMinutes * MINUTE_MS);

  const inFlight = await RefundRequest.find({
    status: REFUND_REQUEST_STATUS.PROCESSING,
    razorpayRefundId: { $type: "string" },
    initiatedAt: { $lte: cutoff },
    isDeleted: false,
  })
    .limit(100)
    .lean();

  if (!inFlight.length) {
    return {
      checked: 0,
      completed: 0,
      failed: 0,
      stillPending: 0,
      unreachable: 0,
      holdsRepaired,
    };
  }

  let completed = 0;
  let failed = 0;
  let stillPending = 0;
  let unreachable = 0;

  for (const request of inFlight) {
    const transaction = await Transaction.findById(request.transactionId)
      .select("gatewayAccount razorpayPaymentId paidAmount amountRefunded")
      .lean();
    if (!transaction) continue;

    let refund;
    try {
      const { instance } = getRazorpayAccount(transaction.gatewayAccount);
      refund = await instance.refunds.fetch(request.razorpayRefundId);
    } catch (error) {
      // A gateway that cannot be reached is not a failed refund. Counted so a
      // rising number is visible, and left exactly as it was.
      unreachable += 1;
      continue;
    }

    if (refund?.status === "processed") {
      const payment = await fetchPaymentQuietly(transaction);
      const result = await applyRefundCompletion({
        refundRequest: request,
        gatewayTotalRefunded:
          payment?.amount_refunded !== undefined
            ? payment.amount_refunded / 100
            : undefined,
        utr: refund?.acquirer_data?.arn,
      });
      if (result.applied) completed += 1;
      continue;
    }

    if (refund?.status === "failed") {
      await RefundRequest.updateOne(
        { _id: request._id, status: REFUND_REQUEST_STATUS.PROCESSING },
        {
          $set: {
            status: REFUND_REQUEST_STATUS.FAILED,
            failedAt: new Date(),
            failureReason:
              refund?.status_reason || "Razorpay reported the refund as failed",
            // Still open, and the hold stays on: the money has not gone back.
            isOpen: true,
          },
        },
      );
      failed += 1;
      continue;
    }

    stillPending += 1;
  }

  return {
    checked: inFlight.length,
    completed,
    failed,
    stillPending,
    unreachable,
    holdsRepaired,
  };
};

/**
 * The payment entity, for its cumulative `amount_refunded`.
 *
 * Best-effort: without it `applyRefundCompletion` falls back to adding this
 * refund onto the stored total, which is still monotonic because of the `$max`.
 * A failure here must not stop a completed refund being recorded.
 */
const fetchPaymentQuietly = async (transaction) => {
  try {
    const { instance } = getRazorpayAccount(transaction.gatewayAccount);
    return await instance.payments.fetch(transaction.razorpayPaymentId);
  } catch (error) {
    return null;
  }
};

/**
 * Nudge the outlet before their window runs out.
 *
 * Two reminders, spread across the window, and `remindersSent` is incremented in
 * the **same** conditional update that selects the row — so two instances
 * running the sweep together cannot send the same nudge twice.
 */
exports.remindVendorsAboutRefunds = async () => {
  const config = await getCustomerConfig();
  const windowHours = Number(config.refund?.vendorApprovalHours) || 24;
  const now = Date.now();

  /**
   * At most **one** nudge per row per sweep.
   *
   * ⚠️ An earlier version looped both marks in one pass with a `$lte` filter,
   * and a request already close to its deadline matched both: the second query
   * re-read the row the first had just bumped and fired again. The outlet got
   * two identical reminders a millisecond apart, which reads as a broken system
   * rather than a helpful one.
   *
   * So the sweep asks a different question — *how many nudges should this row
   * have had by now?* — and sends at most the next one. The job runs hourly, so
   * the spacing comes from the schedule rather than from arithmetic here.
   */
  const marks = [0.5, 0.75];

  const candidates = await RefundRequest.find({
    status: REFUND_REQUEST_STATUS.REQUESTED,
    vendorRespondBy: { $gt: new Date(now) },
    remindersSent: { $lt: marks.length },
    isDeleted: false,
  })
    .select("_id brandId claimCode vendorRespondBy remindersSent")
    .limit(200)
    .lean();

  let sent = 0;

  for (const request of candidates) {
    const remaining = new Date(request.vendorRespondBy).getTime() - now;
    const elapsedFraction = 1 - remaining / (windowHours * HOUR_MS);

    // How many marks this row has passed.
    const due = marks.filter((mark) => elapsedFraction >= mark).length;
    if (due <= request.remindersSent) continue;

    /**
     * The count is bumped in the **same** update that claims the row, and the
     * filter names the value it expects to find. Two instances reading the same
     * batch cannot both win: the second one's filter no longer matches.
     */
    const claimed = await RefundRequest.findOneAndUpdate(
      { _id: request._id, remindersSent: request.remindersSent },
      { $set: { remindersSent: request.remindersSent + 1 } },
      { returnDocument: "after" },
    ).lean();

    if (!claimed) continue;

    await sendQuietly(
      () => notifyVendorRefundReminder({ request: claimed }),
      "vendor refund reminder",
    );
    sent += 1;
  }

  return { sent };
};

/**
 * Nudge a customer who was asked for a bank account and has not answered — and,
 * eventually, hand the row to an admin.
 *
 * ### ⚠️ Why the last stage is not another reminder
 *
 * Every other open refund state has a job that resolves it. This one cannot: the
 * only person who can move it is the customer, and some of them never will —
 * the number changed, the app was deleted, they decided ₹200 was not worth the
 * trouble.
 *
 * Meanwhile `Transaction.settlementHold` has been on since the day the refund was
 * raised, which keeps that payment out of **every** future settlement. That is
 * correct while a refund is live and quietly punitive once it has stalled: the
 * vendor is paying, for ever, for a customer's silence.
 *
 * So after `refund.bankDetailsStaleDays` an admin is told. They can release the
 * hold with a written reason — which does **not** cancel the refund. The money
 * is still owed, and if the customer ever does answer,
 * `claimRefundAdjustments` takes the clawback out of a later cycle, because by
 * then the payment carries a `settlementId`. Nothing is written off; the vendor
 * simply stops being frozen.
 *
 * ### One stage per sweep
 *
 * `bankDetailsRemindersSent` is both the record and the claim, bumped in the same
 * update that decides who sends — the same discipline `remindVendorsAboutRefunds`
 * uses above, and for the same reason: an hourly job that re-sent a stage would
 * put the same message in front of someone 24 times a day.
 *
 * @returns {Promise<{ reminded: number, escalated: number }>}
 */
exports.remindCustomersAboutBankDetails = async () => {
  const config = await getCustomerConfig();

  /**
   * Sorted ascending, not trusted from config: saved as `[96, 24]` the stages
   * would fire out of order — the four-day nudge on day one, and the one-day
   * nudge never.
   */
  const marks = [...(config.refund?.bankDetailsReminderHours || [])]
    .map(Number)
    .filter((h) => Number.isFinite(h) && h > 0)
    .sort((a, b) => a - b);

  const staleDays = Number(config.refund?.bankDetailsStaleDays) || 30;
  const now = Date.now();

  const candidates = await RefundRequest.find({
    status: REFUND_REQUEST_STATUS.AWAITING_BANK_DETAILS,
    bankDetailsRequestedAt: { $ne: null },
    // Every stage used up: nothing left to say, and re-reading these for ever
    // is how a sweep stops draining.
    bankDetailsRemindersSent: { $lt: marks.length + 1 },
    isDeleted: false,
  })
    .sort({ bankDetailsRequestedAt: 1 })
    .limit(200)
    .lean();

  let reminded = 0;
  let escalated = 0;

  for (const request of candidates) {
    const waitedMs = now - new Date(request.bankDetailsRequestedAt).getTime();
    const waitedHours = waitedMs / HOUR_MS;

    const marksPassed = marks.filter((mark) => waitedHours >= mark).length;
    const isStale = waitedMs >= staleDays * DAY_MS;

    // The stale hand-off is always the last stage, whatever the marks are.
    const due = isStale ? marks.length + 1 : marksPassed;
    if (due <= request.bankDetailsRemindersSent) continue;

    const nextStage = request.bankDetailsRemindersSent + 1;

    const claimed = await RefundRequest.findOneAndUpdate(
      {
        _id: request._id,
        bankDetailsRemindersSent: request.bankDetailsRemindersSent,
        // ⚠️ Re-checked in the filter. Between the read above and this write the
        // customer may have supplied an account, and nudging them afterwards
        // reads as a system that is not listening.
        status: REFUND_REQUEST_STATUS.AWAITING_BANK_DETAILS,
      },
      { $set: { bankDetailsRemindersSent: nextStage } },
      { returnDocument: "after" },
    ).lean();

    if (!claimed) continue;

    if (nextStage > marks.length) {
      await sendQuietly(
        () =>
          notifyAdminBankDetailsStale({
            request: claimed,
            daysWaiting: Math.floor(waitedMs / DAY_MS),
          }),
        "refund bank details stale",
      );
      escalated += 1;
    } else {
      await sendQuietly(
        () => notifyRefundBankDetailsReminder({ request: claimed, stage: nextStage }),
        "refund bank details reminder",
      );
      reminded += 1;
    }
  }

  return { reminded, escalated };
};
