const { recordLedgerEntry } = require("./recordLedgerEntry");
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

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

  /**
   * The GST that was inside the fee, when the fee was GST-inclusive.
   *
   * Only ever non-zero on a full refund, because the convenience fee is only
   * returned on a full refund — `split.convenienceFeeRefund` is zero otherwise
   * and so is this.
   */
  const inclusiveTaxBack =
    split.convenienceFeeRefund > 0 &&
    (Number(pricing.gstAmount) || 0) > 0 &&
    (Number(pricing.taxOnTop) || 0) === 0
      ? round2(pricing.gstAmount)
      : 0;

  /**
   * The same question again, for the commission's own GST.
   *
   * Inclusive — the capture credited `PLATFORM_REVENUE` with the commission
   * **less** its tax, so the reversal has to come off the same basis. On top —
   * the capture credited the full commission and the tax went to `TAX_PAYABLE`
   * beside it, so there is nothing to net out here.
   *
   * Unlike the fee's version this is proportional: commission is clawed back on
   * a partial refund too, so it scales with `ratio` rather than only appearing
   * on a full one.
   */
  const commissionInclusiveTaxBack = pricing.isGstInclusive
    ? round2(Number(split.commissionTaxReversal) || 0)
    : 0;

  const plan = [
    {
      /**
       * ⚠️ `netBillRefund`, **not** `vendorClawback`.
       *
       * The two are not the same number, and using the wrong one left every
       * fully refunded claim over-crediting the vendor:
       *
       * ```
       * vendorClawback = netBillRefund − vendorPromoReversal − commissionReversal
       * ```
       *
       * It is already net of the promo share. Debiting *that* and then crediting
       * `vendorPromoReversal` on the next line reverses the vendor's promo
       * contribution **twice** — once implicitly, once explicitly. On an ₹800
       * sale with a ₹50 vendor promo share, `VENDOR_PAYABLE` came to rest at
       * **+₹50** after a full refund instead of zero, and that phantom balance is
       * real money the next payout would hand over.
       *
       * These rows mirror the capture, which credits the **gross** `netBill` and
       * debits the promo share separately. `vendorClawback` is the settlement
       * side's number — `computeTotals` uses it for `refundAdjustment`, where net
       * is exactly right.
       */
      entryType: LEDGER_ENTRY_TYPE.COLLECTION,
      amount: split.netBillRefund,
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
      /**
       * ⚠️ Mirrors the capture: the fee **net of tax**.
       *
       * `split.convenienceFeeRefund` is the gross the customer gets back. When
       * GST was inclusive, part of that gross is tax the capture booked to
       * `TAX_PAYABLE`, not revenue — debiting the whole thing here would drive
       * revenue negative by the GST on every refunded sale.
       */
      entryType: LEDGER_ENTRY_TYPE.CONVENIENCE_FEE,
      amount: round2(split.convenienceFeeRefund - inclusiveTaxBack),
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
      // ⚠️ Net of tax, mirroring the capture. See `commissionInclusiveTaxBack`.
      entryType: LEDGER_ENTRY_TYPE.COMMISSION,
      amount: round2(split.commissionReversal - commissionInclusiveTaxBack),
      account: LEDGER_ACCOUNT.PLATFORM_REVENUE,
      direction: LEDGER_DIRECTION.DEBIT,
      narration: `Refund on ${label} — commission reversed`,
    },
    {
      /**
       * The vendor half — a **credit**, giving back what the capture deducted.
       *
       * The capture debits `VENDOR_PAYABLE` by `commissionDeduction`. Without
       * this row a refund would claw back the gross `netBillRefund` from an
       * account that had only ever been credited the net, leaving the vendor
       * **negative** by the commission on every refunded sale — the same phantom
       * balance the capture row fixes, pointing the other way.
       *
       * ⚠️ `commissionDeductionReversal`, not `commissionReversal`: with GST on
       * top the vendor was deducted the tax as well, and crediting only the bare
       * commission would keep their money.
       */
      entryType: LEDGER_ENTRY_TYPE.VENDOR_COMMISSION,
      amount: split.commissionDeductionReversal,
      account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
      direction: LEDGER_DIRECTION.CREDIT,
      narration: `Refund on ${label} — commission deduction reversed`,
    },
    {
      /**
       * ⚠️ The GST we collected on the convenience fee, handed back with it.
       *
       * `split.taxRefund` was being **computed and then ignored** — the split
       * calculator worked it out, and no row ever posted it. So `TAX_PAYABLE`
       * kept the GST on a fee the customer had already been given back: the
       * books said we owed the tax authority tax on revenue we no longer had.
       *
       * Only ever non-zero on a full refund, because the convenience fee is only
       * returned on a full refund — `recordLedgerEntry` skips a zero amount, so
       * a partial refund posts nothing here.
       */
      entryType: LEDGER_ENTRY_TYPE.TAX_COLLECTED,
      /**
       * `taxRefund` covers the on-top case; `inclusiveTaxBack` covers the tax
       * that was hiding inside the fee. Exactly one of the two is ever non-zero.
       *
       * `commissionTaxReversal` is added in **both** cases, because the capture
       * credits the commission's GST to `TAX_PAYABLE` either way — inclusive or
       * on top. Leaving it out would keep tax on our books for a commission we
       * no longer earned.
       */
      amount: round2(
        split.taxRefund +
          inclusiveTaxBack +
          (Number(split.commissionTaxReversal) || 0),
      ),
      account: LEDGER_ACCOUNT.TAX_PAYABLE,
      direction: LEDGER_DIRECTION.DEBIT,
      narration: `Refund on ${label} — GST on the fee and commission returned`,
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
