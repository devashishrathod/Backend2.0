const Settlement = require("../../models/Settlement");
const Transaction = require("../../models/Transaction");
const {
  SETTLEMENT_PRE_PAYOUT_STATUSES,
} = require("../../constants/settlement");

/**
 * Flag the settlement a risk event just landed inside.
 *
 * ### The window this exists for
 *
 * `settlementHold` is only a **pre-claim** filter. Once `buildSettlements` has
 * stamped `settlementId` on a transaction, setting the hold afterwards has no
 * effect on that settlement at all — eligibility was evaluated at claim time,
 * and the compute step reads only what it captured.
 *
 * The build runs at 02:00. An admin approves and the NEFT goes out at 14:00.
 * That is twelve hours in which a `dispute.created` or a refund request lands on
 * a payment already inside a settlement, and nothing about the settlement
 * changes to say so.
 *
 * So the webhook does not try to recompute anything — it **flags**, and approval
 * is where the flag is enforced.
 *
 * ### Why totals are not recomputed here
 *
 * A webhook is a single-document, idempotent write that must stay fast and must
 * survive redelivery. Recomputing a settlement's arithmetic from inside one
 * would mean reading every claimed row on a delivery that may arrive twice, out
 * of order, or during the approval it is racing. Rebuilding is a deliberate
 * admin action with its own guard — see `rebuildSettlement`.
 *
 * @param {object} options
 * @param {object} options.transaction  the row the event landed on
 * @param {string} options.reason       recorded for whoever reads the alert
 * @returns {Promise<{tainted: boolean, settlement?: object}>}
 */
exports.taintSettlement = async ({ transaction, reason }) => {
  const settlementId = transaction?.settlementId;
  if (!settlementId) return { tainted: false };

  /**
   * Only while exclusion is still free.
   *
   * `PROCESSING` and beyond means the money is leaving or has left, and a flag
   * there would be a lie — there is nothing left to exclude. Those cases are a
   * reversal or a clawback against the next cycle, not a revalidation.
   */
  const settlement = await Settlement.findOneAndUpdate(
    {
      _id: settlementId,
      status: { $in: SETTLEMENT_PRE_PAYOUT_STATUSES },
      isDeleted: false,
    },
    {
      $set: { needsRevalidation: true },
      // `$addToSet`, so a redelivered webhook adds nothing the second time.
      $addToSet: { taintedTransactionIds: transaction._id },
    },
    { returnDocument: "after" },
  ).lean();

  if (!settlement) return { tainted: false };

  return { tainted: true, settlement, reason };
};

/**
 * The transactions a settlement can no longer pay for, with enough detail to
 * name them in a refusal.
 *
 * Read at approval time rather than stored, because the flag says *that*
 * something is wrong and this says *what* — and the what can grow between the
 * flag landing and an admin looking.
 */
exports.describeTaintedRows = async (settlement) => {
  const ids = settlement?.taintedTransactionIds || [];
  if (!ids.length) return [];

  return Transaction.find({ _id: { $in: ids } })
    .select("_id invoiceId amount paidAmount settlementHold settlementHoldReason amountRefunded isDisputed disputeStatus")
    .lean();
};
