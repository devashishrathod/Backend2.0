const Settlement = require("../../models/Settlement");
const PayoutLeg = require("../../models/PayoutLeg");
const Transaction = require("../../models/Transaction");
const LedgerEntry = require("../../models/LedgerEntry");
const { getCustomerConfig } = require("../../helpers/settings");
const {
  SETTLEMENT_STATUS,
  SETTLEMENT_PRE_PAYOUT_STATUSES,
  SETTLEMENT_RELEASING_STATUSES,
} = require("../../constants/settlement");
const { PAYOUT_TYPE, PAYOUT_LEG_STATUS } = require("../../constants/payout");
const { LEDGER_ENTRY_TYPE } = require("../../constants/ledger");
const {
  sendQuietly,
  notifyAdminSettlementStuck,
  notifyAdminSettlementLate,
  notifyAdminSettlementLedgerDrift,
} = require("../../helpers/notifications");
const {
  transitionSettlement,
  countClaimedRows,
  releaseSettlementClaims,
} = require("../../helpers/settlements");

const HOUR_MS = 60 * 60 * 1000;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const hoursSince = (date) =>
  Math.floor((Date.now() - new Date(date).getTime()) / HOUR_MS);

/**
 * ### Why a settlement needs sweeps at all
 *
 * Every other money path here fails loudly: a payment that does not capture
 * throws, a refund that does not send is `FAILED` on a worklist. A settlement
 * fails **silently**, in three different ways, and each one looks like nothing
 * happening:
 *
 * | What went wrong | What it looks like |
 * |---|---|
 * | the nightly build never ran | no settlement exists; nobody is owed anything on paper |
 * | a NEFT was started and never confirmed | `PROCESSING` for ever; the vendor reads "on its way" |
 * | a payout booked no ledger row | the books say we still hold money that has gone |
 *
 * None of those raise. They are absences, and an absence has to be looked for.
 */

/**
 * ⚠️ There is no `runSettlementBuild` wrapper here, and there was one briefly.
 *
 * It re-read `settlement.isEnabled` and returned its own `{skipped: true}`
 * before delegating — but `buildSettlements` already enforces that switch and
 * already returns exactly that sentinel. Two copies of one policy is how the two
 * drift; and the wrapper's `skipped: true` sat on the same key the build's normal
 * return uses for a **count** of brands whose settlement already existed, so
 * `if (result.skipped)` was true for "payouts are off" and for "one brand was
 * already built" alike.
 *
 * `jobs/index.js` registers `buildSettlements` directly, the way it registers
 * every other service function.
 */

/**
 * Payouts that left and were never confirmed.
 *
 * ⚠️ This **alerts and does not act**. The money may genuinely have left — a
 * `MANUAL_BANK` NEFT is irreversible the moment it is keyed in — so
 * auto-failing the settlement would write "the bank rejected it" over a transfer
 * that succeeded, release the rows into the next cycle, and pay the vendor
 * twice.
 *
 * Only a person who can see the banking screen knows which happened, so the job
 * fetches that person rather than guessing.
 */
exports.sweepStalePayouts = async ({ staleHours = 6 } = {}) => {
  const cutoff = new Date(Date.now() - staleHours * HOUR_MS);

  const stale = await PayoutLeg.find({
    payoutType: PAYOUT_TYPE.SETTLEMENT,
    status: PAYOUT_LEG_STATUS.INITIATED,
    initiatedAt: { $lte: cutoff },
    isDeleted: false,
  })
    .sort({ initiatedAt: 1 })
    .limit(200)
    .lean();

  if (!stale.length) return { checked: 0, alerted: 0 };

  /**
   * ⚠️ `APPROVED` as well as `PROCESSING`, and the orphan case is the point.
   *
   * `startPayout` creates the leg **first** and moves the status second — its
   * own comment says a crash between the two "leaves an `APPROVED` settlement
   * with an `INITIATED` leg — visible, and the sweep can resolve it". This sweep
   * filtered to `PROCESSING` only, so it skipped precisely that state. The one
   * failure it was written to catch was the one it could not see.
   */
  const settlements = await Settlement.find({
    _id: { $in: stale.map((leg) => leg.settlementId) },
    status: {
      $in: [SETTLEMENT_STATUS.PROCESSING, SETTLEMENT_STATUS.APPROVED],
    },
    isDeleted: false,
  }).lean();

  const byId = new Map(settlements.map((s) => [String(s._id), s]));
  let alerted = 0;

  for (const leg of stale) {
    /**
     * A leg whose settlement has already moved on is not stuck — it is a leg
     * from a payout that was failed or reversed, and the leg row is kept on
     * purpose so the record holds both attempts.
     */
    const settlement = byId.get(String(leg.settlementId));
    if (!settlement) continue;

    await sendQuietly(
      () =>
        notifyAdminSettlementStuck({
          settlement,
          leg,
          hours: hoursSince(leg.initiatedAt),
        }),
      "admin settlement stuck",
    );
    alerted += 1;
  }

  return { checked: stale.length, alerted };
};

/**
 * Money owed for longer than we said it would take.
 *
 * Fires from our side so the first person to know is not the vendor waiting for
 * it. `notReceivedAlertHours` is the promise; past it, somebody should be
 * looking at the settlement rather than at a support ticket.
 *
 * ### The counter, not a timestamp
 *
 * `overdueAlertsSent` is bumped in the **same update that claims the row**, with
 * the expected value in the filter. Two instances reading the same batch cannot
 * both win, and an admin does not get the same alert twice a millisecond apart —
 * the bug that cost a debugging detour on the refund reminders.
 */
exports.alertLateSettlements = async () => {
  const config = await getCustomerConfig();
  const alertHours = Number(config.settlement?.notReceivedAlertHours) || 96;
  const cutoff = new Date(Date.now() - alertHours * HOUR_MS);

  const late = await Settlement.find({
    /**
     * Everything before the money leaves, plus `FAILED` — a bounce that nobody
     * retried is exactly as unpaid as one that was never sent, and it is the
     * one most likely to be forgotten because it already had its moment of
     * attention.
     */
    status: {
      $in: [
        ...SETTLEMENT_PRE_PAYOUT_STATUSES,
        SETTLEMENT_STATUS.FAILED,
        /**
         * A hold is deliberate, but a hold nobody revisited for four days is
         * money sitting still with no owner — and the least likely to be chased,
         * because it already had its moment of attention.
         */
        SETTLEMENT_STATUS.ON_HOLD,
      ],
    },
    netPayable: { $gt: 0 },
    createdAt: { $lte: cutoff },
    overdueAlertsSent: { $lt: 1 },
    isDeleted: false,
  })
    .sort({ createdAt: 1 })
    .limit(200)
    .lean();

  let alerted = 0;

  for (const settlement of late) {
    const claimed = await Settlement.findOneAndUpdate(
      {
        _id: settlement._id,
        overdueAlertsSent: settlement.overdueAlertsSent || 0,
      },
      { $set: { overdueAlertsSent: (settlement.overdueAlertsSent || 0) + 1 } },
      { returnDocument: "after" },
    ).lean();

    if (!claimed) continue;

    const sent = await sendQuietly(
      () =>
        notifyAdminSettlementLate({
          settlement: claimed,
          hours: hoursSince(claimed.createdAt),
        }),
      "admin settlement late",
    );

    /**
     * ⚠️ Give the counter back when the send failed.
     *
     * Bumping before sending is what stops two instances alerting on the same
     * settlement — that part is right and stays. But `sendQuietly` swallows a
     * delivery failure by design, so a mail outage used to burn the only alert
     * this settlement will ever get: the counter said "told them", nobody had
     * been told, and the filter never picked it up again. Unpaid money went
     * quiet permanently because a push provider hiccuped.
     *
     * Rolling back is conditional on the counter still being the value we set,
     * so a concurrent run that legitimately alerted is not undone.
     */
    if (!sent) {
      await Settlement.updateOne(
        {
          _id: claimed._id,
          overdueAlertsSent: claimed.overdueAlertsSent,
        },
        { $set: { overdueAlertsSent: (claimed.overdueAlertsSent || 1) - 1 } },
      );
      continue;
    }

    alerted += 1;
  }

  return { checked: late.length, alerted };
};

/**
 * Do the payout ledger and the bank transfers agree?
 *
 * ### Read-only, on purpose
 *
 * This job **never writes a ledger entry**, and never corrects one. A ledger row
 * is never updated and never deleted — a correction is a new row with
 * `reversalOf` set — and a sweep that could post entries on its own would be a
 * second, unguarded path to the books changing. What it does is notice, and say
 * so, which is the part nothing else in the system does.
 *
 * ### Why both directions matter
 *
 * A leg with no entry means the books claim we still hold money that has gone.
 * An entry with no leg means the books claim we paid money that never left. The
 * first understates our liabilities and the second overstates them, and both
 * read as a healthy system right up until somebody reconciles a bank statement.
 */
exports.reconcileSettlementLedger = async ({ lookbackDays = 7 } = {}) => {
  const since = new Date(Date.now() - lookbackDays * 24 * HOUR_MS);

  const settlements = await Settlement.find({
    status: SETTLEMENT_STATUS.PAID,
    updatedAt: { $gte: since },
    isDeleted: false,
  })
    .select("_id settlementNumber brandId netPayable periodStart periodEnd")
    .limit(500)
    .lean();

  if (!settlements.length) return { checked: 0, drifted: 0 };

  const ids = settlements.map((s) => s._id);

  const [legTotals, ledgerTotals] = await Promise.all([
    PayoutLeg.aggregate([
      {
        $match: {
          payoutType: PAYOUT_TYPE.SETTLEMENT,
          settlementId: { $in: ids },
          status: PAYOUT_LEG_STATUS.PAID,
          isDeleted: false,
        },
      },
      { $group: { _id: "$settlementId", total: { $sum: "$amount" } } },
    ]),
    LedgerEntry.aggregate([
      {
        $match: {
          /**
           * `PAYOUT` only. `RESERVE_HOLD` carries a `settlementId` too but moved
           * no money out, and `PAYOUT_REVERSAL` is a separate type — the ledger
           * corrects by adding a row, never by editing one.
           *
           * A reversed settlement therefore keeps its `PAYOUT` entries while its
           * legs go to `REVERSED`, which would read as drift. It does not reach
           * here at all: the outer query is `status: PAID`, and a reversal moves
           * the settlement to `REVERSED`.
           */
          entryType: LEDGER_ENTRY_TYPE.PAYOUT,
          settlementId: { $in: ids },
          isDeleted: false,
        },
      },
      { $group: { _id: "$settlementId", total: { $sum: "$amount" } } },
    ]),
  ]);

  const legs = new Map(legTotals.map((r) => [String(r._id), round2(r.total)]));
  const ledger = new Map(
    ledgerTotals.map((r) => [String(r._id), round2(r.total)]),
  );

  let drifted = 0;

  for (const settlement of settlements) {
    const key = String(settlement._id);
    const legTotal = legs.get(key) || 0;
    const ledgerTotal = ledger.get(key) || 0;

    // Half a paisa, so rounding on either side never raises an alarm.
    if (Math.abs(legTotal - ledgerTotal) < 0.005) continue;

    await sendQuietly(
      () =>
        notifyAdminSettlementLedgerDrift({ settlement, legTotal, ledgerTotal }),
      "admin settlement ledger drift",
    );
    drifted += 1;
  }

  return { checked: settlements.length, drifted };
};

/**
 * Rows still claimed by a settlement that is finished with them.
 *
 * ### ⚠️ Why this can happen at all
 *
 * `transitionSettlement` changes the status **first**, then runs `beforeRelease`,
 * then releases the rows. That order is deliberate for the ledger — a reversal
 * must be booked before the rows go back — but it means a throw inside
 * `beforeRelease` leaves the settlement in a terminal state with its rows still
 * held. `CANCELLED`, `ABANDONED`, `REVERSED` and `CARRIED_FORWARD` are all
 * terminal, so nothing will ever transition it again, and the release that was
 * supposed to happen never does.
 *
 * Those rows are then invisible to every future cycle: the eligibility
 * predicate wants `settlementId: null` and simply stops matching. No error, no
 * log, and the ledger stays quiet because its own arithmetic is right — the
 * money *is* owed, it just cannot be reached.
 *
 * `countClaimedRows` was written for exactly this check and had no caller.
 *
 * Releasing is safe by definition: these are the statuses
 * `SETTLEMENT_RELEASING_STATUSES` says must release. This only finishes a job
 * that was already decided.
 */
exports.sweepStrandedClaims = async ({ staleHours = 1 } = {}) => {
  const cutoff = new Date(Date.now() - staleHours * HOUR_MS);

  const terminal = await Settlement.find({
    status: { $in: SETTLEMENT_RELEASING_STATUSES },
    updatedAt: { $lte: cutoff },
    isDeleted: false,
  })
    .select("_id settlementNumber brandId status")
    .limit(200)
    .lean();

  let released = 0;
  let settlements = 0;

  for (const settlement of terminal) {
    const held = await countClaimedRows(settlement._id);
    if (!held.transactions && !held.refunds) continue;

    const result = await releaseSettlementClaims(settlement._id);
    released += result.transactions + result.refunds;
    settlements += 1;

    console.warn(
      `[sweepStrandedClaims] ${settlement.settlementNumber || settlement._id} is ` +
        `${settlement.status} but was still holding ${held.transactions} payment(s) ` +
        `and ${held.refunds} refund(s) — released.`,
    );
  }

  return { checked: terminal.length, settlements, released };
};

/**
 * Settlements that were built and then forgotten in `DRAFT`.
 *
 * `buildSettlements` writes the shell first and claims rows second, so a crash
 * in between leaves a `DRAFT` holding nothing. Its `idempotencyKey` still
 * occupies the period, which means the next build **will not** rebuild that
 * brand's day — and the rows just sit there, eligible for ever and settled
 * never.
 *
 * Abandoning the empty shell voids its key, and the next build picks the period
 * up cleanly.
 */
exports.sweepAbandonedDrafts = async ({ staleHours = 3 } = {}) => {
  const cutoff = new Date(Date.now() - staleHours * HOUR_MS);

  const drafts = await Settlement.find({
    status: SETTLEMENT_STATUS.DRAFT,
    createdAt: { $lte: cutoff },
    isDeleted: false,
  })
    .limit(200)
    .lean();

  let abandoned = 0;

  for (const draft of drafts) {
    /**
     * ⚠️ A draft holding rows is swept too, and that is a correction.
     *
     * This used to `continue` on any draft that had claimed rows, reasoning that
     * voiding it would strand them. The reasoning was right about the danger and
     * wrong about the outcome: skipping stranded them anyway. `buildSettlements`
     * claims rows and *then* writes totals, so a process that dies in between
     * leaves precisely this — a `DRAFT` holding a brand's takings, with no
     * totals, that no other sweep looks at and no build will ever revisit
     * because its `idempotencyKey` still owns the period. Permanent, silent, and
     * caused by the exact crash this job exists for.
     *
     * `CANCELLED` is safe for both shapes because it goes through
     * `transitionSettlement`, which **releases** the rows on the way. An empty
     * draft releases nothing; a half-built one gives its rows back to the next
     * cycle, which is where they belonged all along.
     */
    const holds = await Transaction.countDocuments({
      settlementId: draft._id,
    });

    /**
     * `CANCELLED`, through `transitionSettlement`, and not a direct write.
     *
     * `DRAFT → ABANDONED` is not in the state machine — `ABANDONED` means a
     * bounced payout nobody will retry — and widening the machine for a sweep
     * would make it harder to reason about. `CANCELLED` already means "this
     * settlement will never be paid and its rows go back", which is exactly what
     * a dead draft needs -- empty or half-built; the history row records that
     * the sweep did it, not an admin.
     *
     * Going through the helper also means the conditional claim applies: a build
     * that is at this moment finishing the draft wins, and this quietly does
     * nothing rather than voiding the key underneath it.
     */
    try {
      await transitionSettlement({
        settlement: draft,
        to: SETTLEMENT_STATUS.CANCELLED,
        actor: { role: null },
        reason:
          holds > 0
            ? `Half-built draft abandoned after ${hoursSince(draft.createdAt)}h; ` +
              `${holds} claimed payment(s) released back into the next cycle`
            : `Empty draft abandoned after ${hoursSince(draft.createdAt)}h`,
        // Frees the period so the next build can take it.
        set: { idempotencyKey: `STL:VOID:${draft._id}` },
      });
      abandoned += 1;
    } catch (error) {
      /**
       * A 409 here is the conditional claim doing its job — the build finished
       * while this was counting rows. Anything else is worth seeing.
       */
      if (error?.statusCode !== 409) throw error;
    }
  }

  return { checked: drafts.length, abandoned };
};
