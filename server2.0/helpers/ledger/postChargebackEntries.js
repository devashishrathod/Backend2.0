const { recordLedgerEntry } = require("./recordLedgerEntry");
const {
  LEDGER_ENTRY_TYPE,
  LEDGER_ACCOUNT,
  LEDGER_DIRECTION,
} = require("../../constants/ledger");

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

/** The vendor's share of a payment, which is all a chargeback may take back. */
const vendorShareOf = (transaction) => {
  const voucher = transaction?.voucher || {};
  const netBill = Number(voucher.netBill) || 0;
  const promo = Number(voucher.vendorPromoCost) || 0;
  const commission = Number(voucher.commissionAmount) || 0;
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
  const value = Math.min(
    vendorShare,
    amount === undefined || amount === null ? vendorShare : Number(amount) || 0,
  );

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
