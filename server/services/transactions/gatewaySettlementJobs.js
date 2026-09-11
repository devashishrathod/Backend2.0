const Transaction = require("../../models/Transaction");

const {
  getRazorpayAccount,
  isRazorpayAccountConfigured,
} = require("../../configs/razorpay");
const {
  TRANSACTION_PURPOSE,
  ACCOUNT_FOR_PURPOSE,
} = require("../../constants/transaction");
const { PAYMENT_STATUS } = require("../../constants");
const {
  buildTransactionFilter,
  recordFundsReceived,
  fetchSettledPaymentIds,
} = require("../../helpers/transactions");
const {
  sendQuietly,
  notifyAdminGatewayFundsNotReceived,
} = require("../../helpers/notifications");

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Razorpay caps a list page at 100 whatever you ask for. */
const PAGE = 100;

/**
 * The account voucher-claim money lands in, derived rather than hardcoded.
 *
 * ⚠️ This job is `VOUCHER_CLAIM`-only on purpose, and the reason is not scope
 * discipline — it is that `fundsReceivedAt` has exactly one reader,
 * `buildEligibilityFilter`, and that filter is itself `VOUCHER_CLAIM`-only.
 * Running this against the subscription account would page through its batches
 * and mark nothing, because `recordFundsReceived` filters on the same purpose.
 */
const CLAIM_ACCOUNT = ACCOUNT_FOR_PURPOSE[TRANSACTION_PURPOSE.VOUCHER_CLAIM];

/** Razorpay's list APIs take seconds, not milliseconds. */
const unix = (date) => Math.floor(date.getTime() / 1000);

const describeGatewayError = (error) =>
  error?.error?.description || error?.message || "unknown gateway error";

/**
 * Page a Razorpay list endpoint to the end.
 *
 * Written once rather than twice because the two call sites below differ only in
 * which method they call, and a paging loop copied is a paging loop where one
 * copy loses its last page.
 */
const pageAll = async (fetchPage) => {
  const items = [];
  let skip = 0;

  for (;;) {
    const page = await fetchPage({ count: PAGE, skip });
    const batch = page?.items || [];
    items.push(...batch);
    if (batch.length < PAGE) break;
    skip += batch.length;
  }

  return items;
};

/**
 * Ask the gateway what it has actually settled, and mark those payments.
 *
 * ### ⚠️ Why this exists at all, when a webhook already does it
 *
 * `settlement.processed` is the only thing that fills `fundsReceivedAt`, and
 * `buildEligibilityFilter` refuses to settle a payment without it. So one lost
 * delivery — the endpoint down for a deploy, Razorpay giving up after its
 * retries, an event never subscribed in the dashboard — means that batch of
 * payments becomes **permanently unpayable**, and:
 *
 *  - nothing errors: the webhook that never arrived logs nothing,
 *  - nothing alerts: `alertLateSettlements` reads `Settlement` rows, and a
 *    payment that never becomes eligible produces none,
 *  - the build **succeeds**, reporting `brandsChecked: 0`.
 *
 * Every safety net in this codebase watches money that is in the wrong place.
 * This is the one shape none of them could see: money that never entered the
 * pipeline. It was found by a person asking, weeks in, with ₹2.1L of captured
 * payments sitting unsettled at the gateway and every job green.
 *
 * ### Pull, not push
 *
 * The webhook stays the fast path — this is the backstop that makes the fast
 * path optional. `settlements.all()` is the gateway's own record of what it
 * settled, so a delivery we never received is still recoverable from it.
 *
 * ### Safe to run as often as you like
 *
 * `recordFundsReceived` carries `fundsReceivedAt: null` in its filter, so a
 * second pass over the same batch updates nothing and reports zero. The
 * `alreadyRecorded` check above it is a cost optimisation, not a correctness
 * one: it skips the per-settlement `payments.all()` round trip for batches we
 * have already seen.
 *
 * ### It never throws
 *
 * A gateway outage must not read as a broken job. Failures are collected and
 * returned, so the job's health record names the settlement that failed rather
 * than the run reporting a clean sweep it did not do.
 *
 * @param {object} [args]
 * @param {number} [args.lookbackDays] how far back to ask the gateway
 * @param {number} [args.alertHours]   how old an unsettled capture must be to alert
 * @param {Date}   [args.at]           the moment the run is measured from
 */
exports.reconcileGatewaySettlements = async ({
  /**
   * Seven days rather than one.
   *
   * The window has to comfortably outlast the thing it is covering: a webhook
   * lost to a deploy is recovered within minutes, but one lost to an endpoint
   * that was misconfigured for a weekend is not. Razorpay's own list is cheap to
   * page and the work is bounded by batches we have not seen, so a wider window
   * costs one extra list call and nothing else.
   */
  lookbackDays = 7,
  /**
   * Razorpay settles on T+2, so 48h is the first moment a payment is genuinely
   * late rather than merely waiting. Tighter than this and every ordinary
   * capture raises an alarm, which is how a real one gets muted.
   */
  alertHours = 48,
  at = new Date(),
} = {}) => {
  if (!isRazorpayAccountConfigured(CLAIM_ACCOUNT)) {
    return {
      skipped: true,
      reason: `The ${CLAIM_ACCOUNT} Razorpay account has no credentials configured.`,
    };
  }

  const { instance } = getRazorpayAccount(CLAIM_ACCOUNT);

  const from = unix(new Date(at.getTime() - lookbackDays * DAY_MS));
  const to = unix(at);

  // ---------------- what has the gateway settled ----------------
  let settlements;
  try {
    settlements = await pageAll((opts) =>
      instance.settlements.all({ from, to, ...opts }),
    );
  } catch (error) {
    /**
     * Returned rather than thrown, so the alert below still runs. A gateway that
     * cannot be listed is exactly when somebody should hear that money is piling
     * up — refusing to look is not a reason to stay quiet about it.
     */
    const listFailure = describeGatewayError(error);
    console.error(
      `[reconcileGatewaySettlements] could not list settlements: ${listFailure}`,
    );
    return {
      ...(await alertOnStuckFunds({ at, alertHours })),
      listFailure,
    };
  }

  let alreadyRecorded = 0;
  let recorded = 0;
  let paymentsMarked = 0;
  const failures = [];

  for (const settlement of settlements) {
    /**
     * ⚠️ Only a settlement the gateway says is done.
     *
     * A `created` settlement is a batch Razorpay has decided on and not yet
     * paid. Marking its payments received would put money into a payout run
     * before it reached our bank — the single thing `fundsReceivedAt` exists to
     * prevent, arriving through the back door.
     */
    if (settlement.status !== "processed") continue;

    const seen = await Transaction.countDocuments({
      razorpaySettlementId: settlement.id,
    });
    if (seen > 0) {
      alreadyRecorded += 1;
      continue;
    }

    const settledAt = settlement.created_at
      ? new Date(settlement.created_at * 1000)
      : new Date();

    let paymentIds;
    try {
      /**
       * ⚠️ The recon report, never `payments.all({ settlement_id })` — that call
       * ignores the filter and hands back the whole account. See
       * `helpers/transactions/fetchSettledPaymentIds.js`.
       *
       * This job would have been the worse of the two places to get it wrong:
       * the webhook fires once per batch, while this sweeps every batch in the
       * window on every run.
       */
      paymentIds = await fetchSettledPaymentIds({
        instance,
        settlementId: settlement.id,
        settledAt,
      });
    } catch (error) {
      /**
       * One batch we cannot read must not cost the others theirs. The next run
       * retries it, and the failure is named so the job's health record says
       * which settlement rather than "1 failed".
       */
      failures.push({
        settlementId: settlement.id,
        reason: describeGatewayError(error),
      });
      continue;
    }

    /**
     * An empty batch is not an error and must not be recorded as one. A gateway
     * settlement can legitimately carry only refunds or adjustments, and a day
     * the report is unavailable for yields nothing either — in both cases there
     * is simply nothing of ours to mark, and the next run will try again.
     */
    if (!paymentIds.length) continue;

    const result = await recordFundsReceived({
      settlementId: settlement.id,
      settledAt,
      paymentIds,
    });

    recorded += 1;
    paymentsMarked += result.updated;

    if (result.updated > 0) {
      console.log(
        `[reconcileGatewaySettlements] ${settlement.id}: ${result.updated} payment(s) ` +
          `marked received that no webhook had told us about.`,
      );
    }
  }

  return {
    account: CLAIM_ACCOUNT,
    settlementsSeen: settlements.length,
    alreadyRecorded,
    recorded,
    paymentsMarked,
    ...(failures.length ? { failed: failures.length, failures } : {}),
    ...(await alertOnStuckFunds({ at, alertHours })),
  };
};

/**
 * Money the customer paid that the gateway still has not passed on.
 *
 * ⚠️ Run **after** the reconcile above, never instead of it. Anything the pull
 * recovered is no longer stuck, and alerting on the pre-reconcile figure would
 * page an admin about a backlog the same run had just cleared.
 *
 * Reports rather than acts. There is nothing here for code to fix —
 * `fundsReceivedAt` is observed, never inferred, and the whole design rests on
 * not guessing that money has arrived.
 */
const alertOnStuckFunds = async ({ at, alertHours }) => {
  const stuckBefore = new Date(at.getTime() - alertHours * HOUR_MS);

  const [summary] = await Transaction.aggregate([
    {
      $match: {
        ...buildTransactionFilter({ purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM }),
        verified: true,
        status: PAYMENT_STATUS.CAPTURED,
        fundsReceivedAt: null,
        verifiedAt: { $lte: stuckBefore },
      },
    },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        // What the customer actually paid, not what the order was opened for.
        total: { $sum: { $ifNull: ["$paidAmount", "$amount"] } },
        oldestAt: { $min: "$verifiedAt" },
      },
    },
  ]);

  if (!summary?.count) return { stuck: 0 };

  const total = Math.round((summary.total || 0) * 100) / 100;

  await sendQuietly(
    () =>
      notifyAdminGatewayFundsNotReceived({
        count: summary.count,
        total,
        oldestAt: summary.oldestAt,
        hours: alertHours,
        account: CLAIM_ACCOUNT,
      }),
    "admin gateway funds not received",
  );

  return {
    stuck: summary.count,
    stuckValue: total,
    stuckOldestAt: summary.oldestAt,
  };
};

exports.alertOnStuckFunds = alertOnStuckFunds;
