const { recordLedgerEntry } = require("./recordLedgerEntry");
const LedgerEntry = require("../../models/LedgerEntry");
const {
  LEDGER_ENTRY_TYPE,
  LEDGER_ACCOUNT,
  LEDGER_DIRECTION,
} = require("../../constants/ledger");

/**
 * How much of the vendor's share this payment has **already** given up.
 *
 * ⚠️ One payment can carry more than one dispute — a chargeback that escalates
 * to pre-arbitration arrives as a second dispute with its own id — and
 * `ledger_type_dispute_unique` lets each book its own `CHARGEBACK`. The per-call
 * cap alone is not enough: two disputes could each pass a check against the
 * whole vendor share and together book more than the vendor was ever paid.
 *
 * Reversals count the other way, so a dispute we later won gives its headroom
 * back rather than permanently shrinking what a genuine second loss may take.
 */
const alreadyBookedAgainst = async (transactionId, exceptDisputeId) => {
  const rows = await LedgerEntry.find({
    transactionId,
    entryType: {
      $in: [
        LEDGER_ENTRY_TYPE.CHARGEBACK,
        LEDGER_ENTRY_TYPE.CHARGEBACK_REVERSAL,
      ],
    },
    /**
     * ⚠️ Everything **except this dispute's own** rows.
     *
     * Razorpay redelivers these. Counting a dispute's own earlier entry would
     * leave it no headroom on the second delivery, so the amount would come out
     * as zero and `recordLedgerEntry` would report it *skipped* — when the truth
     * is that it is a **duplicate**, already booked, which the unique index says
     * far more clearly. The cap is about what other disputes have taken.
     */
    ...(exceptDisputeId ? { disputeId: { $ne: exceptDisputeId } } : {}),
    isDeleted: false,
  })
    .select("entryType amount")
    .lean();

  const total = rows.reduce(
    (sum, row) =>
      sum +
      (row.entryType === LEDGER_ENTRY_TYPE.CHARGEBACK
        ? Number(row.amount) || 0
        : -(Number(row.amount) || 0)),
    0,
  );

  return Math.round(total * 100) / 100;
};

/**
 * A chargeback, booked against the vendor's payable.
 *
 * ### ⚠️ Why this had to exist
 *
 * `CHARGEBACK` and `CHARGEBACK_REVERSAL` were in the rules table from the start
 * and **nothing ever wrote one**, while `chargebackAdjustment` sat hardcoded at
 * `0` in `computeTotals`. So a payment that was settled, paid out, and then
 * pulled back by the customer's bank left no trace anywhere: the platform
 * absorbed the whole loss silently, and the books showed a healthy sale.
 *
 * `vendor_settlement_plan.md` §7.5 already decided what should happen —
 * *"4. Agle settlement se recovery — payout ke baad wala default"* — so this is
 * the strategy that was written down, implemented.
 *
 * ### What is booked, and what is not
 *
 * Only the **vendor's** share. A chargeback takes back the whole amount the
 * customer paid, but our convenience fee and the promo we funded were never the
 * vendor's, and clawing those from them would charge them for our side of the
 * sale. The platform's share of a lost dispute is a platform loss.
 *
 * ### Idempotency
 *
 * `ledger_type_dispute_unique` keys on the dispute, not the transaction — a
 * payment can be disputed after it was already refunded, and Razorpay both
 * redelivers dispute webhooks and sends them **out of order** (a late `lost`
 * after a `won`). Keying on the transaction would collide with the capture rows;
 * keying on nothing would claw the vendor back once per delivery.
 */

/**
 * The vendor's share of a payment, which is all a chargeback may take back.
 *
 * ⚠️ `commissionDeduction`, not `commissionAmount` — the same net the settlement
 * paid them. With GST on top of the commission the two differ, and clawing back
 * the larger figure would take from the vendor tax they never received. Falls
 * back to `commissionAmount` for a claim frozen before the field existed, where
 * GST was off and the two were equal.
 */
const vendorShareOf = (transaction) => {
  const voucher = transaction?.voucher || {};
  const netBill = Number(voucher.netBill) || 0;
  const promo = Number(voucher.vendorPromoCost) || 0;
  const commission =
    Number(voucher.commissionDeduction ?? voucher.commissionAmount) || 0;
  return Math.round((netBill - promo - commission) * 100) / 100;
};

/**
 * We lost the dispute. The bank has taken the money.
 *
 * @param {object} args
 * @param {object} args.transaction the payment that was charged back
 * @param {string} args.disputeId   Razorpay's `disp_…`
 * @param {number} [args.amount]    what the bank took; defaults to the vendor's share
 */
exports.postChargebackLoss = async ({ transaction, disputeId, amount }) => {
  if (!transaction?._id || !disputeId) {
    return { posted: 0, duplicate: false, entry: null, amount: 0 };
  }

  /**
   * Capped at the vendor's share.
   *
   * The dispute amount is what the *customer* paid, which includes our fee and
   * our half of the promo. Debiting that whole figure to `VENDOR_PAYABLE` would
   * charge the vendor for money that was never theirs.
   */
  const vendorShare = vendorShareOf(transaction);

  /**
   * ⚠️ Capped against what this payment has **already** given up, not against
   * the vendor's whole share.
   *
   * With two disputes on one payment — a chargeback and the pre-arbitration that
   * follows it — the per-call cap let each one take the full vendor share, so
   * together they could book more than the vendor was ever paid. The books would
   * then say we recovered money that never existed.
   */
  const alreadyBooked = await alreadyBookedAgainst(transaction._id, disputeId);
  const headroom = Math.max(0, Math.round((vendorShare - alreadyBooked) * 100) / 100);

  const requested =
    amount === undefined || amount === null ? vendorShare : Number(amount) || 0;
  const value = Math.min(headroom, requested);

  const result = await recordLedgerEntry({
    entryType: LEDGER_ENTRY_TYPE.CHARGEBACK,
    account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
    direction: LEDGER_DIRECTION.DEBIT,
    amount: value,
    transactionId: transaction._id,
    voucherClaimId: transaction.voucher?.claimId,
    brandId: transaction.brandId,
    disputeId,
    occurredAt: new Date(),
    reason: `Chargeback lost (${disputeId})`,
    narration:
      `Chargeback on ${transaction.invoiceId || transaction.razorpayPaymentId || "payment"} ` +
      `— recovered from the brand`,
  });

  return { ...result, posted: result.entry && !result.duplicate ? 1 : 0, amount: value };
};

/**
 * We won it after all, or it was reversed.
 *
 * ⚠️ Only meaningful when a loss was booked first. `recordLedgerEntry` skips a
 * zero amount, and the dispute index keeps this to one row — so a `won` that
 * arrives with no prior loss writes nothing rather than crediting a vendor for
 * money nobody ever took.
 */
exports.postChargebackReversal = async ({ transaction, disputeId, amount }) => {
  if (!transaction?._id || !disputeId || !(amount > 0)) {
    return { posted: 0, duplicate: false, entry: null, amount: 0 };
  }

  const result = await recordLedgerEntry({
    entryType: LEDGER_ENTRY_TYPE.CHARGEBACK_REVERSAL,
    account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
    direction: LEDGER_DIRECTION.CREDIT,
    amount,
    transactionId: transaction._id,
    voucherClaimId: transaction.voucher?.claimId,
    brandId: transaction.brandId,
    disputeId,
    occurredAt: new Date(),
    reason: `Chargeback won (${disputeId})`,
    narration:
      `Chargeback on ${transaction.invoiceId || transaction.razorpayPaymentId || "payment"} ` +
      `— won, returned to the brand`,
  });

  return { ...result, posted: result.entry && !result.duplicate ? 1 : 0, amount };
};

exports.vendorShareOf = vendorShareOf;
