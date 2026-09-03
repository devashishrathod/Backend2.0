const RefundRequest = require("../../models/RefundRequest");
const Dispute = require("../../models/Dispute");
const Transaction = require("../../models/Transaction");
const LedgerEntry = require("../../models/LedgerEntry");
const { buildTransactionFilter } = require("../transactions");
const { REFUND_REQUEST_STATUS } = require("../../constants/refund");
const { DISPUTE_STATUS } = require("../../constants/webhook");
const { LEDGER_ENTRY_TYPE } = require("../../constants/ledger");
const { TRANSACTION_PURPOSE } = require("../../constants/transaction");

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * What a brand owes us that no settlement has been able to take back.
 *
 * ### ⚠️ Why this is not simply "the negative bit of the ledger"
 *
 * A brand's `VENDOR_PAYABLE` balance answers *"what is the net position?"*, and
 * that is the right number for a balance sheet. It is the wrong number for a
 * decision, because it nets the debt against takings that have not been paid out
 * yet — money we still owe them. A brand can be ₹2,000 in the black on that
 * balance and still be carrying an ₹800 chargeback that no cycle can ever reach,
 * because every cycle claims it, nets negative, and releases it again.
 *
 * So this counts the **rows**: the deductions that are still unclaimed, how old
 * the oldest is, and how many cycles have already tried. That is the thing an
 * admin decides about, and the thing a write-off closes.
 *
 * ### The loop it exists to name
 *
 * `netPayable <= 0` sends a settlement to `CARRIED_FORWARD`, and carrying
 * forward **is** releasing every claim it held — by design, so the debt and the
 * takings both flow into the next cycle. While the brand trades, new sales net
 * it off and the loop ends by itself. When they stop trading it never does: the
 * same rows are claimed and released for ever, nothing errors, and no report
 * shows it. This is the report.
 */
exports.computeVendorDebt = async ({ brandId, includeRows = true } = {}) => {
  /**
   * Both sides of the debt, unclaimed and not already written off.
   *
   * `settlementId: null` / `recoverySettlementId: null` is the same "still
   * unclaimed" test the two claim functions use — deliberately, so this can
   * never report a debt a cycle has quietly already taken.
   */
  const [refunds, disputes] = await Promise.all([
    RefundRequest.find({
      brandId,
      status: REFUND_REQUEST_STATUS.COMPLETED,
      settlementId: null,
      writtenOffAt: null,
      isDeleted: false,
    })
      .select("_id transactionId split completedAt createdAt")
      .lean(),
    Dispute.find({
      brandId,
      status: DISPUTE_STATUS.LOST,
      recoverySettlementId: null,
      writtenOffAt: null,
      isDeleted: false,
    })
      .select("_id disputeId transactionId amount resolvedAt createdAt")
      .lean(),
  ]);

  if (!refunds.length && !disputes.length) {
    return { brandId, outstanding: 0, refunds: [], disputes: [], oldestAt: null };
  }

  /**
   * ⚠️ Only rows on a payment the vendor was actually paid for.
   *
   * The identical test both claim functions apply. A refund or a chargeback on a
   * payment that never reached the vendor is not a debt — `settlementHold` kept
   * that money out of every cycle, so we still hold it. Counting it here would
   * invent a receivable, and a write-off against it would book a platform cost
   * for money the platform never lost.
   */
  const referenced = [
    ...refunds.map((r) => r.transactionId),
    ...disputes.map((d) => d.transactionId),
  ].filter(Boolean);

  const paidOut = await Transaction.find({
    ...buildTransactionFilter({ purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM }),
    _id: { $in: referenced },
    settlementId: { $ne: null },
    isDeleted: false,
  })
    .select("_id")
    .lean();

  const recoverable = new Set(paidOut.map((t) => String(t._id)));

  const owedRefunds = refunds.filter((r) =>
    recoverable.has(String(r.transactionId)),
  );
  const owedDisputes = disputes.filter((d) =>
    recoverable.has(String(d.transactionId)),
  );

  /**
   * ⚠️ Chargebacks are valued at what the **ledger booked**, never recomputed.
   *
   * `postChargebackLoss` caps each loss against what the payment has already
   * given up, so a second dispute on the same payment can only take the headroom
   * left. Working the share out again from `voucher` ignores that cap and would
   * report — and then write off — money that was never lost. Reversals count the
   * other way, so a dispute later won contributes nothing.
   *
   * This is the same read `claimChargebackAdjustments` does, for the same reason.
   */
  const bookedByDispute = new Map();
  if (owedDisputes.length) {
    const booked = await LedgerEntry.aggregate([
      {
        $match: {
          disputeId: { $in: owedDisputes.map((d) => d.disputeId) },
          entryType: {
            $in: [
              LEDGER_ENTRY_TYPE.CHARGEBACK,
              LEDGER_ENTRY_TYPE.CHARGEBACK_REVERSAL,
            ],
          },
          isDeleted: false,
        },
      },
      {
        $group: {
          _id: "$disputeId",
          amount: {
            $sum: {
              $cond: [
                { $eq: ["$entryType", LEDGER_ENTRY_TYPE.CHARGEBACK] },
                "$amount",
                { $multiply: ["$amount", -1] },
              ],
            },
          },
        },
      },
    ]);
    for (const row of booked) bookedByDispute.set(row._id, row.amount);
  }

  const refundRows = owedRefunds.map((r) => ({
    refundRequestId: r._id,
    transactionId: r.transactionId,
    amount: round2(r.split?.vendorClawback),
    at: r.completedAt || r.createdAt,
  }));

  const disputeRows = owedDisputes
    .map((d) => ({
      disputeRowId: d._id,
      disputeId: d.disputeId,
      transactionId: d.transactionId,
      amount: round2(Math.max(0, bookedByDispute.get(d.disputeId) || 0)),
      at: d.resolvedAt || d.createdAt,
    }))
    /**
     * A dispute with nothing booked against it is not a debt. It happens when a
     * loss was fully reversed by a later `won` — the ledger says zero, and
     * reporting it anyway would show a debt whose write-off would move no money.
     */
    .filter((row) => row.amount > 0);

  const all = [...refundRows, ...disputeRows];
  const outstanding = round2(all.reduce((sum, row) => sum + row.amount, 0));

  const dates = all.map((row) => row.at).filter(Boolean).map((d) => new Date(d));
  const oldestAt = dates.length
    ? new Date(Math.min(...dates.map((d) => d.getTime())))
    : null;

  return {
    brandId,
    outstanding,
    oldestAt,
    ageDays: oldestAt
      ? Math.floor((Date.now() - oldestAt.getTime()) / 86400000)
      : 0,
    counts: { refunds: refundRows.length, disputes: disputeRows.length },
    ...(includeRows ? { refunds: refundRows, disputes: disputeRows } : {}),
  };
};

/**
 * Every brand carrying an unclaimed deduction older than `olderThanDays`.
 *
 * ⚠️ Two cheap `distinct`s rather than a scan over settlements. The set of
 * unclaimed rows is naturally small — each cycle claims what it can — while the
 * set of brands and of settlements only grows, so starting from the rows keeps
 * this proportional to the work rather than to the history.
 *
 * Deliberately **does not** value the debt: that costs a ledger aggregation per
 * brand, and the caller wants a shortlist before it pays for that.
 */
exports.brandsWithAgedDebt = async ({ olderThanDays = 90 } = {}) => {
  const before = new Date(Date.now() - olderThanDays * 86400000);

  const [fromRefunds, fromDisputes] = await Promise.all([
    RefundRequest.distinct("brandId", {
      status: REFUND_REQUEST_STATUS.COMPLETED,
      settlementId: null,
      writtenOffAt: null,
      isDeleted: false,
      /**
       * ⚠️ `completedAt`, with `createdAt` as the fallback — matched to what
       * `computeVendorDebt` ages the row by, so the shortlist and the figure
       * cannot disagree about whether something is 89 days old or 91.
       */
      $or: [
        { completedAt: { $lte: before } },
        { completedAt: null, createdAt: { $lte: before } },
      ],
    }),
    Dispute.distinct("brandId", {
      status: DISPUTE_STATUS.LOST,
      recoverySettlementId: null,
      writtenOffAt: null,
      isDeleted: false,
      $or: [
        { resolvedAt: { $lte: before } },
        { resolvedAt: null, createdAt: { $lte: before } },
      ],
    }),
  ]);

  const seen = new Map();
  for (const id of [...fromRefunds, ...fromDisputes]) {
    if (id) seen.set(String(id), id);
  }
  return [...seen.values()];
};
