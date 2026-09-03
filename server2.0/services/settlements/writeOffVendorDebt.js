const RefundRequest = require("../../models/RefundRequest");
const Dispute = require("../../models/Dispute");
const { throwError } = require("../../utils");
const { ROLES } = require("../../constants");
const { computeVendorDebt } = require("../../helpers/settlements");
const { recordLedgerEntry } = require("../../helpers/ledger");
const {
  LEDGER_ENTRY_TYPE,
  LEDGER_ACCOUNT,
  LEDGER_DIRECTION,
} = require("../../constants/ledger");

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * Stop chasing a debt we are not going to collect, and say so in the books.
 *
 * ### ⚠️ The loop this ends
 *
 * A brand whose deductions outrun their takings builds a settlement with a
 * negative `netPayable`. That goes `CARRIED_FORWARD`, and carrying forward **is**
 * releasing every claim it held — deliberately, so the debt and the takings both
 * flow into the next cycle. While the brand still trades, new sales net it off
 * and the loop ends by itself.
 *
 * The day they stop trading it never does. The same rows are claimed and
 * released every cycle, for ever. Nothing errors, nothing is logged, and no
 * report shows it — the money simply sits on our books as a receivable from
 * somebody who is not coming back. `alertVendorDebt` finds it; this closes it.
 *
 * ### What it writes, and why both sides
 *
 * Per debt row, a matched pair of `MANUAL_ADJUSTMENT`s:
 *
 *  - **CREDIT `VENDOR_PAYABLE`** — cancels the debit that made them owe it, so
 *    their balance returns to zero and no future cycle sees a debt.
 *  - **DEBIT `PLATFORM_COST`** — we absorbed it. Without this the loss vanishes
 *    from the books entirely, and *"what did chargebacks cost us this year"* has
 *    no answer.
 *
 * ⚠️ The reference (`refundRequestId` / `disputeId`) goes on the **vendor side
 * only**. `ONCE_PER_REFUND` and `ONCE_PER_DISPUTE` are unique on
 * `{reference, entryType}`, so putting it on both would make the second row of
 * the pair a duplicate-key no-op — the vendor's debt would clear while the
 * platform's cost silently never appeared, and the books would be short by
 * exactly the amount forgiven. The pair is therefore written together and the
 * cost side is skipped only when the vendor side reports it was already there.
 *
 * ⚠️ Ledger first, rows second — the same order every reversal here uses. The
 * unique index makes the vendor row idempotent, so a retry after a crash re-books
 * nothing and goes on to mark the rows. Marking first and crashing would forgive
 * a debt with no trace of where it went.
 *
 * ### Why the vendor is not notified
 *
 * A write-off is not an action they can take, and *"we have written off ₹800 you
 * owed us"* invites *"I never owed that"* from somebody who has usually already
 * left the platform. What they **do** need to hear is the cycle that paid them
 * nothing because of the deduction, and that is sent at the time it happens —
 * see `notifyVendorSettlementCarriedForward`. This is bookkeeping after the fact.
 */
exports.writeOffVendorDebt = async (actor = {}, payload = {}) => {
  if (actor.role !== ROLES.ADMIN) {
    throwError(403, "Only Trydood can write off a vendor debt.");
  }

  const { brandId, reason, olderThanDays } = payload;
  if (!brandId) throwError(422, "brandId is required.");

  const note = String(reason || "").trim();
  // `recordLedgerEntry` refuses an unexplained MANUAL_ADJUSTMENT anyway. Saying
  // so here means the caller learns it before anything has been touched.
  if (note.length < 3) {
    throwError(422, "Please say why this debt is being written off.");
  }

  const debt = await computeVendorDebt({ brandId });

  if (!debt.outstanding) {
    return {
      brandId,
      writtenOff: 0,
      rows: { refunds: 0, disputes: 0 },
      message: "There is nothing outstanding against this brand.",
    };
  }

  /**
   * An optional age floor, because *"write off everything older than 90 days"*
   * is the real request far more often than *"write off everything"* — a brand
   * that is still trading may be carrying one ancient chargeback beside a refund
   * from last week that the next cycle will collect on its own.
   */
  const cutoff =
    Number.isFinite(Number(olderThanDays)) && Number(olderThanDays) > 0
      ? new Date(Date.now() - Number(olderThanDays) * 86400000)
      : null;

  const olderThanCutoff = (row) =>
    !cutoff || (row.at && new Date(row.at) <= cutoff);

  const refunds = debt.refunds.filter(olderThanCutoff);
  const disputes = debt.disputes.filter(olderThanCutoff);

  if (!refunds.length && !disputes.length) {
    return {
      brandId,
      writtenOff: 0,
      rows: { refunds: 0, disputes: 0 },
      message: `Nothing outstanding against this brand is older than ${olderThanDays} days.`,
    };
  }

  const at = new Date();
  const by = actor.userId || actor._id;
  let writtenOff = 0;

  const absorb = async ({ amount, refundRequestId, disputeId, what }) => {
    const value = round2(amount);
    if (value <= 0) return false;

    const { duplicate } = await recordLedgerEntry({
      entryType: LEDGER_ENTRY_TYPE.MANUAL_ADJUSTMENT,
      account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
      direction: LEDGER_DIRECTION.CREDIT,
      amount: value,
      brandId,
      refundRequestId,
      disputeId,
      reason: note,
      narration: `Written off — ${what} no longer recoverable`,
      createdBy: by,
      occurredAt: at,
    });

    /**
     * ⚠️ Only when the vendor side was genuinely new.
     *
     * The two rows are always written together, so a vendor row that already
     * exists means its cost row does too. Writing the cost side again would
     * double the platform's recorded loss — and unlike the vendor side, nothing
     * indexes it to stop that.
     */
    if (!duplicate) {
      await recordLedgerEntry({
        entryType: LEDGER_ENTRY_TYPE.MANUAL_ADJUSTMENT,
        account: LEDGER_ACCOUNT.PLATFORM_COST,
        direction: LEDGER_DIRECTION.DEBIT,
        amount: value,
        brandId,
        reason: note,
        narration: `Absorbed — ${what} written off against this brand`,
        createdBy: by,
        occurredAt: at,
      });
    }

    writtenOff = round2(writtenOff + value);
    return true;
  };

  for (const row of disputes) {
    await absorb({
      amount: row.amount,
      disputeId: row.disputeId,
      what: `chargeback ${row.disputeId}`,
    });
  }

  for (const row of refunds) {
    await absorb({
      amount: row.amount,
      refundRequestId: row.refundRequestId,
      what: "refund clawback",
    });
  }

  /**
   * ⚠️ `writtenOffAt: null` stays in the filter — the same conditional-claim
   * discipline the settlement claims use. Two admins acting at once cannot both
   * mark a row, so the second finds nothing and the stamp records who was
   * actually first.
   */
  const stamp = { writtenOffAt: at, writtenOffBy: by, writtenOffReason: note };

  const [markedDisputes, markedRefunds] = await Promise.all([
    disputes.length
      ? Dispute.updateMany(
          {
            _id: { $in: disputes.map((d) => d.disputeRowId) },
            writtenOffAt: null,
            isDeleted: false,
          },
          { $set: stamp },
        )
      : { modifiedCount: 0 },
    refunds.length
      ? RefundRequest.updateMany(
          {
            _id: { $in: refunds.map((r) => r.refundRequestId) },
            writtenOffAt: null,
            isDeleted: false,
          },
          { $set: stamp },
        )
      : { modifiedCount: 0 },
  ]);

  return {
    brandId,
    writtenOff,
    rows: {
      disputes: markedDisputes.modifiedCount || 0,
      refunds: markedRefunds.modifiedCount || 0,
    },
    reason: note,
    writtenOffAt: at,
    message: `₹${writtenOff.toFixed(2)} written off. It will not be deducted from any future settlement.`,
  };
};

/**
 * What a brand owes, for an admin looking at it before deciding.
 *
 * Read-only, and separate from the write on purpose: *"show me the debt"* is the
 * step that happens several times and *"forgive it"* is the one that happens
 * once, and an endpoint that did both would make the safe question require the
 * dangerous permission.
 */
exports.getVendorDebt = async (actor = {}, brandId) => {
  if (actor.role !== ROLES.ADMIN) {
    throwError(403, "Only Trydood can read a brand's outstanding balance.");
  }
  if (!brandId) throwError(422, "brandId is required.");

  return computeVendorDebt({ brandId });
};
