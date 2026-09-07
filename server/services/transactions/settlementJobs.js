const Transaction = require("../../models/Transaction");

const { buildTransactionFilter } = require("../../helpers/transactions");
const {
  notifyAdmins,
  ADMIN_PATHS,
  adminUrl,
  deepLink,
} = require("../../helpers/notifications");
const { formatDateTime } = require("../../helpers/notifications/formatDateTime");
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_SEVERITY,
} = require("../../constants/notification");
const { SETTLEMENT_STAGE } = require("../../constants/transaction");
/**
 * The same map the webhook receiver dispatches on, so a resume and a live
 * delivery can never disagree about which settler owns a money flow.
 */
const { resolveSettler, SETTLER_PURPOSES } = require("./webhookSettlers");

const MINUTE_MS = 60 * 1000;

/** "2 voucher claim, 1 subscription" — for an alert that spans both flows. */
const describeFlows = (byPurpose = {}) =>
  Object.entries(byPurpose)
    .map(
      ([purpose, count]) =>
        `${count} ${String(purpose).toLowerCase().replace(/_/g, " ")}`,
    )
    .join(", ") || "none";

/**
 * Finish settlements that were claimed and then abandoned.
 *
 * ### ⚠️ Why this lives here and not under a flow
 *
 * It was written inside `services/voucherClaims/claimJobs.js`, beside the three
 * jobs that really are claim-specific, and scoped to
 * `purpose: VOUCHER_CLAIM`. That is how a subscription payment stranded
 * half-settled came to have no repair path at all: the machinery was there, the
 * sweep simply could not see it. Now that it dispatches every money flow, a
 * flow-specific folder is the wrong place to look for it — and looking in the
 * wrong place is how the gap survived.
 *
 * ### The crash this staged design exists for
 *
 * The conditional claim is terminal, so a process that dies after it leaves a
 * transaction `verified: true` with the work half done and **no way back in** —
 * verify says `alreadyVerified`, the webhook retry says `alreadySettled`.
 *
 * Every step of a settle is idempotent, so this does not need to know where it
 * stopped. It runs the whole thing again and the finished parts are no-ops.
 *
 * ### Dispatched rather than branched
 *
 * Both flows share the staged design and the `resume: true` contract, so the
 * sweep is shared; what differs is which settler runs, and that is already
 * answered by the registry the webhook receiver uses.
 *
 * `resolveSettler` returning null is a **hard stop** for that row, not a
 * fallthrough — running a claim settler against a subscription payment is how a
 * customer's ₹760 gets settled against a vendor's ₹4,999 plan. The query only
 * selects purposes the registry knows, so a null here means the two disagree,
 * which is worth failing loudly over.
 *
 * ### ⚠️ Scoped by BOTH purpose and the stage existing
 *
 * `settlementStage != "COMPLETE"` is true of a **missing** field, and every
 * transaction written before the field existed has none. Without the `$exists`
 * guard this job's first run would try to re-settle the entire subscription
 * history. The M10 migration marked those `COMPLETE`, so the data is clean too —
 * but a query that only works because of a migration someone remembered to run
 * is not a query worth relying on. That guard matters more now than it did when
 * this was claims-only: admin grants never enter the staged pipeline at all and
 * carry no stage, and this is what keeps the sweep from adopting them.
 *
 * @param {object}  [args]
 * @param {number}  [args.olderThanMinutes]  how settled a row must be to count
 *                                           as stranded rather than in flight
 * @param {number}  [args.perPurposeLimit]   rows per money flow per run
 */
exports.resumeIncompleteSettlements = async ({
  olderThanMinutes = 5,
  perPurposeLimit = 50,
} = {}) => {
  const cutoff = new Date(Date.now() - olderThanMinutes * MINUTE_MS);

  const now = new Date();

  /**
   * ⚠️ A budget **per flow**, and ordered by how little we have tried.
   *
   * Two separate problems, both about which rows get a turn.
   *
   * The sort: this was a bare `.limit(50)` with no ordering. A row that always
   * throws — corrupt pricing, a voucher since deleted — kept its place in
   * natural order and consumed a slot on every run. Fifty of those and the sweep
   * spends every tick failing on the same fifty while newly stranded payments
   * are never reached. `settlementResumeAt` is the back-off gate and
   * `settlementResumeAttempts` is the ordering, so a poisoned row is never
   * dropped — it just stops queueing ahead of a payment nobody has tried yet.
   *
   * The budget: one pool across both purposes let either starve the other. A bad
   * afternoon on voucher claims filled every slot, and a vendor whose
   * subscription stranded waited behind fifty claims on every tick for as long
   * as the backlog lasted. The two flows have nothing to do with each other and
   * one must not be able to hold the other's repair path hostage — so each gets
   * its own query and its own budget. The cost is one indexed query per purpose
   * instead of one for both, which is nothing beside the per-row settle work.
   *
   * This is the path that repairs a customer who was charged and got nothing, so
   * fairness here matters more than anywhere else in the codebase.
   */
  const perPurpose = await Promise.all(
    SETTLER_PURPOSES.map((purpose) =>
      Transaction.find({
        ...buildTransactionFilter({ purpose, verified: true }),
        settlementStage: { $exists: true, $ne: SETTLEMENT_STAGE.COMPLETE },
        verifiedAt: { $lte: cutoff },
        $or: [
          { settlementResumeAt: { $exists: false } },
          { settlementResumeAt: null },
          { settlementResumeAt: { $lte: now } },
        ],
      })
        .sort({ settlementResumeAttempts: 1, verifiedAt: 1 })
        .limit(perPurposeLimit),
    ),
  );

  const stranded = perPurpose.flat();

  if (!stranded.length) return { found: 0, resumed: 0, failed: 0 };

  let resumed = 0;
  let failed = 0;
  // Which flow broke, not just how many rows. A claim failure and a subscription
  // failure are investigated in completely different places, and the alert used
  // to name only one of them.
  const failedByPurpose = {};

  for (const transaction of stranded) {
    try {
      const settle = resolveSettler(transaction.purpose);
      if (!settle) {
        // The query and the registry have gone out of step. Better to record it
        // against this row than to guess which settler a money flow wants.
        throw new Error(
          `No settler registered for purpose "${transaction.purpose}".`,
        );
      }

      await settle({
        transaction,
        // The payment is already recorded on the row; resume does not re-read
        // the gateway and does not re-take the conditional claim.
        payment: { captured: true, id: transaction.razorpayPaymentId },
        resume: true,
      });
      resumed++;
    } catch (error) {
      failed++;
      failedByPurpose[transaction.purpose] =
        (failedByPurpose[transaction.purpose] || 0) + 1;

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
      title: `${failed} settlement(s) could not be resumed`,
      body:
        `Money was captured and the settlement never finished. A voucher claim ` +
        `left this way has a customer who paid and a vendor who has not been ` +
        `credited; a subscription has a vendor who paid and may be missing their ` +
        `plan, their invoice or both. Broken down by flow: ${describeFlows(failedByPurpose)}.`,
      meta: { failed, found: stranded.length, failedByPurpose },
      /**
       * ⚠️ Keyed on **which flows failed**, not only the hour.
       *
       * One alert an hour is the right rate, but a bare hour key meant the first
       * flow to fail claimed it and the second was silently deduped away — so an
       * hour in which voucher claims were already failing could hide the first
       * subscription failure entirely. Including the flows makes those two
       * different alerts while still collapsing a retry storm within each.
       */
      dedupeKey: `RESUME_FAILED:${Object.keys(failedByPurpose).sort().join("+")}:${new Date().toISOString().slice(0, 13)}`,
      /**
       * The **list**, not a record: this alert is about a batch, and the
       * individual ids are in `meta` for a client that wants them. Pointing at
       * one of several would hide the rest.
       */
      deepLink: deepLink(ADMIN_PATHS.TRANSACTIONS),
      mail: {
        lines: [
          ["Could not resume", String(failed)],
          ["By flow", describeFlows(failedByPurpose)],
          ["Stranded settlements found", String(stranded.length)],
          ["Checked at", formatDateTime(new Date())],
        ],
        ctaLabel: "Open transactions",
        ctaUrl: adminUrl(ADMIN_PATHS.TRANSACTIONS),
        footnote:
          "Every step of a settle is idempotent, so these are safe to resume again once the cause is fixed.",
      },
    });
  }

  return { found: stranded.length, resumed, failed };
};

exports.describeFlows = describeFlows;
