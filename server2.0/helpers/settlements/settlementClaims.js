const Transaction = require("../../models/Transaction");
const RefundRequest = require("../../models/RefundRequest");
const { TRANSACTION_PURPOSE } = require("../../constants/transaction");
const { PAYMENT_STATUS } = require("../../constants");
const { REFUND_REQUEST_STATUS } = require("../../constants/refund");
const { DISPUTE_STATUS } = require("../../constants/webhook");
const { buildTransactionFilter } = require("../transactions");

/**
 * Claiming and releasing the rows a settlement is built from.
 *
 * Modelled on `promoCodes/promoReservation.js` — reserve, release, sweep —
 * because it is the same shape of problem: a scarce thing is taken out of
 * circulation while something decides about it, and the taking must be atomic
 * while the giving-back must be impossible to forget.
 *
 * ### Why the claim comes before the arithmetic
 *
 * The obvious order is: select the eligible rows, total them, write the
 * settlement. But between selecting and writing, a refund can land — and that
 * payment is then counted in a settlement it should not be in, while the refund
 * is *also* deducted. The same money moves twice.
 *
 * So the shell is created first, the rows are claimed **atomically** with
 * `settlementId: null` as the lock, and only then is anything totalled — from
 * exactly the rows that were captured, never from a fresh query.
 *
 * ### ⚠️ And why release is not optional
 *
 * The lock points one way. Every future cycle's predicate asks for
 * `settlementId: null`, so a settlement that leaves the happy path without
 * releasing makes its rows **invisible to every cycle for ever** — no error, no
 * alert, the predicate simply stops matching. One admin click could strand a
 * month of a brand's takings, and the ledger would stay quiet because its own
 * arithmetic is correct: no `PAYOUT` was written, so `VENDOR_PAYABLE` still shows
 * the money as owed. It is owed. It just cannot be reached.
 */

/**
 * The rows a settlement may take.
 *
 * @param {object} options
 * @param {string} options.brandId
 * @param {Date}   options.eligibleBefore  `periodEnd` — the cycle's ceiling
 * @param {Date}   options.fundsReceivedBefore  the gateway must have settled it
 */
exports.buildEligibilityFilter = ({
  brandId,
  eligibleBefore,
  fundsReceivedBefore,
}) => ({
  ...buildTransactionFilter({ purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM }),
  brandId,
  verified: true,
  status: PAYMENT_STATUS.CAPTURED,

  /** The lock. Nothing else stops a payment being counted in two settlements. */
  settlementId: null,

  /**
   * ⚠️ The single flag that carries ineligibility, and it is **monotonic**.
   *
   * Not `isDisputed: false`: that field tracks whether a dispute is *live*, so a
   * chargeback we **lost** correctly sets it back to `false` — and keying on it
   * would make the row we just lost look perfectly payable.
   */
  settlementHold: false,

  /**
   * ⚠️ Only a **fully** refunded payment is excluded.
   *
   * This was `amountRefunded: { $lte: 0 }`, which excluded a partially refunded
   * payment too — for ever, because the field is monotonic. The intent was
   * right (do not settle the vendor for the whole sale when part of it went
   * back) but the effect was not: the vendor's remaining share became invisible
   * to every future cycle, silently, while `claimRefundAdjustments` deducted the
   * clawback for the refunded part from a later cycle anyway. On an ₹810 payment
   * with ₹300 refunded the vendor was out roughly ₹1,100 on an ₹800 sale.
   *
   * A partial refund is now netted **in the arithmetic** instead of by
   * exclusion: the row is claimed at its full value and the refund is claimed
   * beside it, so `computeTotals` subtracts exactly the clawback. See
   * `claimRefundAdjustments` below for the half that makes that safe.
   *
   * `isRefunded` is derived from `amountRefunded` in the same pipeline update
   * that writes it, so the two cannot disagree — which is what made a boolean
   * unsafe here before.
   */
  isRefunded: { $ne: true },

  // The cycle's ceiling: everything captured up to the end of the period.
  verifiedAt: { $lte: eligibleBefore },

  /**
   * ⚠️ And the floor that matters more: the gateway has actually paid us.
   *
   * `verifiedAt` says the customer paid. Razorpay holds that money for its own
   * cycle before settling the batch to our bank, and a T+N rule computed from
   * `verifiedAt` is a *guess* that it will have. The times that guess is wrong —
   * an account under review, a batch held over a bank holiday — are exactly when
   * paying it out means funding the payout ourselves.
   */
  fundsReceivedAt: { $ne: null, $lte: fundsReceivedBefore },

  isDeleted: false,
});

/**
 * Take the rows for this settlement, atomically.
 *
 * `settlementId: null` in the filter is the whole lock: two builds racing on the
 * same brand cannot both claim a row, because the second's filter no longer
 * matches. Returns what was actually captured — the caller must total **that**,
 * not re-query.
 */
exports.claimTransactions = async ({
  settlementId,
  brandId,
  eligibleBefore,
  fundsReceivedBefore,
}) => {
  const filter = exports.buildEligibilityFilter({
    brandId,
    eligibleBefore,
    fundsReceivedBefore,
  });

  await Transaction.updateMany(filter, { $set: { settlementId } });

  // Read back what this settlement now owns. Anything a concurrent build took
  // first is simply absent, which is the correct outcome.
  return Transaction.find({ settlementId, isDeleted: false }).lean();
};

/**
 * Claim the refunds whose deduction this settlement will carry.
 *
 * ⚠️ Locked the same way and for the same reason. A `refundAdjustment` computed
 * live from "this brand's completed refunds" would apply the **same deduction in
 * every cycle** — one chargeback would be taken off the vendor again and again,
 * for ever, and each month's arithmetic would look internally consistent.
 */
exports.claimRefundAdjustments = async ({ settlementId, brandId }) => {
  /**
   * ⚠️ Only refunds whose payment was, or is being, settled.
   *
   * A clawback makes sense for exactly one reason: the vendor was paid for a
   * sale that later came back. If the payment never reached them, there is
   * nothing to claw — and deducting anyway takes the money twice.
   *
   * That is precisely what happened to a **fully** refunded payment: it is
   * excluded from eligibility for ever, so `settlementId` stays null and the
   * vendor is never paid for it — and this used to claim its refund regardless
   * and deduct the clawback from their *other* sales.
   *
   * `settlementId: { $ne: null }` on the payment is the whole test, and it
   * covers both cases in one:
   *
   *  - **paid in an earlier cycle** — the payment carries that settlement's id,
   *    so the refund is claimed here and deducted now. The carry-back case this
   *    function was written for.
   *  - **partially refunded, being settled right now** — `claimTransactions`
   *    ran first and stamped this settlement's id on it, so the refund is
   *    claimed alongside and nets off in the same cycle.
   *
   * A fully refunded payment matches neither, and its refund is left alone.
   */
  /**
   * ⚠️ Refunds first, then their payments — not the other way round.
   *
   * Asking Mongo for "every settled payment of this brand" and feeding the ids
   * into an `$in` is correct and does not scale: that set is the brand's entire
   * history and grows for ever, while the answer only ever depends on the
   * handful of refunds still unclaimed. A busy brand would build a
   * hundred-thousand-element `$in` once per cycle, per brand.
   *
   * Unclaimed refunds are naturally bounded — each cycle claims the ones it can
   * — so starting there keeps this proportional to the work, not to the history.
   */
  const candidates = await RefundRequest.find({
    brandId,
    status: REFUND_REQUEST_STATUS.COMPLETED,
    settlementId: null,
    isDeleted: false,
  })
    .select("_id transactionId")
    .lean();

  if (candidates.length) {
    const settledPayments = await Transaction.find({
      _id: { $in: candidates.map((r) => r.transactionId) },
      settlementId: { $ne: null },
      isDeleted: false,
    })
      .select("_id")
      .lean();

    const payable = new Set(settledPayments.map((t) => String(t._id)));
    const claimable = candidates.filter((r) =>
      payable.has(String(r.transactionId)),
    );

    if (claimable.length) {
      await RefundRequest.updateMany(
        { _id: { $in: claimable.map((r) => r._id) } },
        { $set: { settlementId } },
      );
    }
  }

  return RefundRequest.find({ settlementId, isDeleted: false }).lean();
};

/**
 * Claim the lost chargebacks this settlement will recover.
 *
 * ⚠️ Locked on `Transaction.chargebackSettlementId`, exactly like the refunds
 * above and for the same reason: a `chargebackAdjustment` computed live from
 * "this brand's lost disputes" would deduct the **same** chargeback in every
 * cycle, for ever, and each month's figures would look internally consistent
 * while the vendor was charged again and again for one lost dispute.
 *
 * ### Only a payment the vendor was actually paid for
 *
 * `settlementId: { $ne: null }` is the same test `claimRefundAdjustments` uses.
 * If the dispute landed before the payout, `settlementHold` already kept the
 * payment out of every cycle — the vendor never received it, so there is nothing
 * to recover, and deducting anyway would take the money from sales they *were*
 * paid for.
 */
exports.claimChargebackAdjustments = async ({ settlementId, brandId }) => {
  const lost = await Transaction.find({
    ...buildTransactionFilter({ purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM }),
    brandId,
    disputeStatus: DISPUTE_STATUS.LOST,
    // Paid out, so there is something to claw back.
    settlementId: { $ne: null },
    // Not already recovered by an earlier cycle.
    chargebackSettlementId: null,
    isDeleted: false,
  })
    .select("_id voucher disputeId disputeAmount invoiceId")
    .limit(500)
    .lean();

  if (!lost.length) return [];

  await Transaction.updateMany(
    { _id: { $in: lost.map((t) => t._id) }, chargebackSettlementId: null },
    {
      $set: {
        chargebackSettlementId: settlementId,
        chargebackRecoveredAt: new Date(),
      },
    },
  );

  // Read back what this settlement now owns, the same way the others do.
  return Transaction.find({ chargebackSettlementId: settlementId, isDeleted: false })
    .select("_id voucher disputeId disputeAmount invoiceId")
    .lean();
};

/**
 * Give everything back.
 *
 * ⚠️ **The only exit from a non-`PAID` terminal state.** Called from the status
 * transition itself, never left to a caller to remember — that is precisely the
 * mistake this guards against.
 *
 * Both collections, because both were locked. A release that forgot the refunds
 * would leave those deductions attached to a dead settlement and silently
 * forgiven.
 *
 * @param {string} settlementId
 * @param {string} reason  recorded on the settlement's history, not here
 */
exports.releaseSettlementClaims = async (settlementId) => {
  if (!settlementId) return { transactions: 0, refunds: 0 };

  const [transactions, refunds, chargebacks] = await Promise.all([
    Transaction.updateMany(
      { settlementId, isDeleted: false },
      { $set: { settlementId: null } },
    ),
    RefundRequest.updateMany(
      { settlementId, isDeleted: false },
      { $set: { settlementId: null } },
    ),
    /**
     * ⚠️ And the chargeback claims, which are a **separate** lock on the same
     * collection. A release that forgot these would leave a lost dispute
     * attached to a dead settlement and silently forgiven — the vendor keeps
     * money the bank took back from us.
     */
    Transaction.updateMany(
      { chargebackSettlementId: settlementId, isDeleted: false },
      { $set: { chargebackSettlementId: null, chargebackRecoveredAt: null } },
    ),
  ]);

  return {
    transactions: transactions.modifiedCount ?? 0,
    refunds: refunds.modifiedCount ?? 0,
    chargebacks: chargebacks.modifiedCount ?? 0,
  };
};

/**
 * How many rows a settlement is still holding.
 *
 * Used by the stale sweep and by `reconcileLedger`'s stranding invariant: a
 * terminal-failed settlement still holding rows is money nobody can reach.
 */
exports.countClaimedRows = async (settlementId) => {
  const [transactions, refunds, chargebacks] = await Promise.all([
    Transaction.countDocuments({ settlementId, isDeleted: false }),
    RefundRequest.countDocuments({ settlementId, isDeleted: false }),
    Transaction.countDocuments({
      chargebackSettlementId: settlementId,
      isDeleted: false,
    }),
  ]);
  return { transactions, refunds, chargebacks };
};
