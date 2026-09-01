const { recordLedgerEntry } = require("./recordLedgerEntry");
const {
  LEDGER_ENTRY_TYPE,
  LEDGER_ACCOUNT,
  LEDGER_DIRECTION,
} = require("../../constants/ledger");
const { GATEWAY_FEE_BEARER } = require("../../constants/transaction");

/**
 * Post every ledger row a completed refund produces.
 *
 * ### Each row reverses the capture row it mirrors
 *
 * `postCaptureEntries` books six rows when a claim is paid. A refund undoes
 * them, and it does so under **the same entry types, in the opposite
 * direction** — not under one flat `REFUND` type:
 *
 * | Capture | Refund | Account |
 * |---|---|---|
 * | `COLLECTION` +netBill | `COLLECTION` −clawback | `VENDOR_PAYABLE` |
 * | `VENDOR_PROMO_SHARE` −share | `VENDOR_PROMO_SHARE` +share | `VENDOR_PAYABLE` |
 * | `CONVENIENCE_FEE` +fee | `CONVENIENCE_FEE` −fee | `PLATFORM_REVENUE` |
 * | `PLATFORM_PROMO_COST` −share | `PLATFORM_PROMO_COST` +share | `PLATFORM_COST` |
 * | `COMMISSION` +commission | `COMMISSION` −commission | `PLATFORM_REVENUE` |
 * | `GATEWAY_FEE` −MDR | `GATEWAY_FEE` −MDR **again** | `PLATFORM_COST` |
 *
 * Keeping the types means a report grouped by type shows each figure net of its
 * own reversals. A flat `REFUND` type would show a promo cost that never came
 * down and a refund total that explains nothing about where it went.
 *
 * The gateway fee is the one row that is **not** a reversal: Razorpay keeps its
 * fee when a payment is refunded, so the loss is booked a second time rather
 * than undone. `calculateRefundSplit` zeroes it on every refund after the first,
 * so a partial-then-partial pair still books it once.
 *
 * ### Idempotent against a replayed webhook
 *
 * Razorpay does redeliver `refund.processed`. Every row carries
 * `refundRequestId`, and `ledger_type_refund_unique` allows one row per entry
 * type per refund — so a redelivery books nothing and reports duplicates
 * instead. The once-per-transaction index cannot do this job: a payment may be
 * refunded twice, and each refund's rows share the same `transactionId`.
 *
 * @param {object} args
 * @param {object} args.transaction    the Transaction being refunded
 * @param {object} args.claim          the VoucherClaim
 * @param {object} args.split          the frozen `RefundRequest.split`
 * @param {object} args.refundRequest  the request these rows belong to
 */
exports.postRefundEntries = async ({
  transaction,
  claim,
  split,
  refundRequest,
}) => {
  if (!split || !refundRequest?._id) {
    return { posted: 0, duplicates: 0, entries: [] };
  }

  const pricing = claim?.pricing || {};

  const common = {
    transactionId: transaction?._id,
    voucherClaimId: claim?._id,
    brandId: claim?.brandId || transaction?.brandId,
    refundRequestId: refundRequest._id,
    currency: pricing.currency,
    /**
     * Dated when the refund completed, not when the claim was captured.
     *
     * The capture rows belong to the cycle the sale happened in; the reversal
     * belongs to the cycle the money went back in. Dating both alike would make
     * a refunded claim vanish from the month it was actually sold in.
     */
    occurredAt: refundRequest.completedAt || new Date(),
    /**
     * ⚠️ Takes these rows out of the once-per-transaction index, which is what
     * makes them writable at all — a reversal is by definition a **second** row
     * of the same type on the same transaction, so leaving it in that index
     * would make the correction impossible. `ledger_type_refund_unique` is what
     * keeps them idempotent instead.
     */
    isReversal: true,
    reason: `Refund ${refundRequest._id}`,
  };

  const label = claim?.claimCode || transaction?.razorpayPaymentId || "claim";

  const plan = [
    {
      entryType: LEDGER_ENTRY_TYPE.COLLECTION,
      amount: split.vendorClawback,
      account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
      direction: LEDGER_DIRECTION.DEBIT,
      narration: `Refund on ${label} — clawed back from the brand`,
    },
    {
      entryType: LEDGER_ENTRY_TYPE.VENDOR_PROMO_SHARE,
      amount: split.vendorPromoReversal,
      account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
      direction: LEDGER_DIRECTION.CREDIT,
      narration: `Refund on ${label} — brand's promo share reversed`,
    },
    {
      entryType: LEDGER_ENTRY_TYPE.CONVENIENCE_FEE,
      amount: split.convenienceFeeRefund,
      account: LEDGER_ACCOUNT.PLATFORM_REVENUE,
      direction: LEDGER_DIRECTION.DEBIT,
      narration: `Refund on ${label} — convenience fee returned`,
    },
    {
      /**
       * A **credit** to `PLATFORM_COST`, which reads backwards until you see it:
       * the capture debited this account for the discount we funded. Refunding
       * the sale means we no longer fund it, so the cost comes off.
       */
      entryType: LEDGER_ENTRY_TYPE.PLATFORM_PROMO_COST,
      amount: split.platformPromoReversal,
      account: LEDGER_ACCOUNT.PLATFORM_COST,
      direction: LEDGER_DIRECTION.CREDIT,
      narration: `Refund on ${label} — platform's promo share reversed`,
    },
    {
      entryType: LEDGER_ENTRY_TYPE.COMMISSION,
      amount: split.commissionReversal,
      account: LEDGER_ACCOUNT.PLATFORM_REVENUE,
      direction: LEDGER_DIRECTION.DEBIT,
      narration: `Refund on ${label} — commission reversed`,
    },
    {
      // Not a reversal in substance — Razorpay keeps its fee either way, so this
      // books the loss a second time rather than undoing the first.
      entryType: LEDGER_ENTRY_TYPE.GATEWAY_FEE,
      amount: split.gatewayFeeAbsorbed,
      account:
        transaction?.gatewayFeeBearer === GATEWAY_FEE_BEARER.PLATFORM
          ? LEDGER_ACCOUNT.PLATFORM_COST
          : LEDGER_ACCOUNT.VENDOR_PAYABLE,
      direction: LEDGER_DIRECTION.DEBIT,
      narration: `Refund on ${label} — Razorpay MDR not returned`,
    },
  ];

  const entries = [];
  let posted = 0;
  let duplicates = 0;

  for (const item of plan) {
    const result = await recordLedgerEntry({ ...common, ...item });
    if (result.skipped) continue;
    if (result.duplicate) duplicates += 1;
    else posted += 1;
    if (result.entry) entries.push(result.entry);
  }

  return { posted, duplicates, entries };
};
