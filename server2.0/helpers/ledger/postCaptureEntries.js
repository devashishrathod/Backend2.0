const { recordLedgerEntry } = require("./recordLedgerEntry");
const {
  LEDGER_ENTRY_TYPE,
  LEDGER_ACCOUNT,
} = require("../../constants/ledger");
const { GATEWAY_FEE_BEARER } = require("../../constants/transaction");

/**
 * The part of the convenience fee that is actually revenue.
 *
 * ⚠️ `taxOnTop === 0` while `gstAmount > 0` is the **inclusive** case: the slab
 * amount already contains the tax, so revenue is what is left after backing it
 * out. With GST on top, `convenienceFee` is already net and this returns it
 * unchanged; with GST off, both are zero and it does the same.
 */
const feeNetOfTax = (pricing) => {
  const fee = Number(pricing?.convenienceFee) || 0;
  const gst = Number(pricing?.gstAmount) || 0;
  const onTop = Number(pricing?.taxOnTop) || 0;
  const inclusive = gst > 0 && onTop === 0 ? gst : 0;
  return Math.round((fee - inclusive) * 100) / 100;
};

/**
 * Post every ledger row a captured claim produces, in one call.
 *
 * Six entries, all derived from the frozen pricing block, all idempotent. Called
 * from `settleVoucherClaimPayment` — and safe to call again, which is exactly
 * what the resume job does after a crash mid-settle.
 *
 * For a ₹1,000 bill with a 20% offer, a ₹50 promo shared 30/70 and a ₹10 fee:
 *
 * | Entry | Account | Amount |
 * |---|---|---:|
 * | `COLLECTION` | VENDOR_PAYABLE | + 800.00 |
 * | `VENDOR_PROMO_SHARE` | VENDOR_PAYABLE | − 15.00 |
 * | `CONVENIENCE_FEE` | PLATFORM_REVENUE | + 10.00 |
 * | `PLATFORM_PROMO_COST` | PLATFORM_COST | − 35.00 |
 * | `GATEWAY_FEE` | PLATFORM_COST *(by bearer)* | − 17.94 |
 * | `TAX_COLLECTED` | TAX_PAYABLE | + 0.00 *(GST off)* |
 *
 * Zero-amount entries are skipped, so a claim with no promo posts three rows
 * rather than six of which three say nothing.
 *
 * ### The gateway fee is the one that was missing
 *
 * Razorpay settles **net**: a ₹760 payment arrives as roughly ₹742. The vendor
 * is paid on the gross `netBill`, so without this row the difference came
 * silently out of the platform's margin and appeared in no report. It lands on
 * whichever account `gatewayFeeBearer` names — `PLATFORM` today, and now
 * visible rather than implied.
 *
 * @param {object} args
 * @param {object} args.transaction  the captured Transaction
 * @param {object} args.claim        the VoucherClaim
 * @param {object} args.pricing      the frozen `voucherPricingSchema` block
 * @returns {Promise<{ posted: number, duplicates: number, entries: object[] }>}
 */
exports.postCaptureEntries = async ({ transaction, claim, pricing }) => {
  const common = {
    transactionId: transaction?._id,
    voucherClaimId: claim?._id,
    brandId: claim?.brandId || transaction?.brandId,
    // The moment the money moved, not the moment this ran. A resumed settle
    // writes today for something that happened yesterday, and dating it today
    // would move it into the wrong settlement cycle.
    occurredAt: transaction?.verifiedAt || transaction?.paidAt || new Date(),
    currency: pricing?.currency,
  };

  const brandLabel = claim?.brandSnapshot?.name || common.brandId;

  const plan = [
    {
      entryType: LEDGER_ENTRY_TYPE.COLLECTION,
      amount: pricing?.netBill,
      narration: `Claim ${claim?.claimCode || ""} — bill ${pricing?.billAmount} less offer ${pricing?.offerDiscount}`.trim(),
    },
    {
      entryType: LEDGER_ENTRY_TYPE.VENDOR_PROMO_SHARE,
      amount: pricing?.vendorPromoCost,
      narration: `Promo ${pricing?.promoCode || ""} — brand's share`.trim(),
    },
    {
      /**
       * ⚠️ The fee **net of tax**, which is not always `convenienceFee`.
       *
       * With GST *on top* (`taxOnTop > 0`) the slab amount is already net and
       * the tax rides beside it — crediting both is right.
       *
       * With GST **inclusive** the slab amount *contains* the tax:
       * `calculateVoucherPricing` backs it out into `gstAmount` and leaves
       * `taxOnTop: 0`. Crediting the gross fee to `PLATFORM_REVENUE` and then
       * the tax again to `TAX_PAYABLE` books the same rupees twice — revenue
       * overstated by exactly the GST on every single sale, and only when
       * somebody turns `isGstInclusive` on.
       */
      entryType: LEDGER_ENTRY_TYPE.CONVENIENCE_FEE,
      amount: feeNetOfTax(pricing),
      narration: `Convenience fee on ${brandLabel}`,
    },
    {
      entryType: LEDGER_ENTRY_TYPE.PLATFORM_PROMO_COST,
      amount: pricing?.platformPromoCost,
      narration: `Promo ${pricing?.promoCode || ""} — platform's share`.trim(),
    },
    {
      entryType: LEDGER_ENTRY_TYPE.GATEWAY_FEE,
      amount: transaction?.gatewayFee,
      /**
       * Whoever bears it. Only `PLATFORM` is in use today, and a `VENDOR` or
       * `SHARED` bearer needs a vendor agreement before it is switched on — so
       * the account is read from the transaction rather than assumed.
       */
      account:
        transaction?.gatewayFeeBearer === GATEWAY_FEE_BEARER.PLATFORM
          ? LEDGER_ACCOUNT.PLATFORM_COST
          : LEDGER_ACCOUNT.VENDOR_PAYABLE,
      narration: `Razorpay MDR + GST on ${transaction?.razorpayPaymentId || "payment"}`,
    },
    {
      entryType: LEDGER_ENTRY_TYPE.TAX_COLLECTED,
      amount: pricing?.gstAmount,
      narration: `GST on convenience fee (${pricing?.taxType || "n/a"})`,
    },
    {
      /**
       * ⚠️ This was missing, while the refund path reversed it.
       *
       * `postRefundEntries` debits `PLATFORM_REVENUE` by `commissionReversal`,
       * so without a credit here every refund drove revenue negative by a
       * commission that was never booked as earned. Invisible today only because
       * `settlement.commissionPercent` defaults to `0` and
       * `recordLedgerEntry` skips a zero amount — the day somebody sets a real
       * rate, the books start losing that much per refund.
       *
       * ⚠️ Note what this does **not** do: it credits our revenue and does not
       * debit `VENDOR_PAYABLE`. The commission is deducted from the vendor on the
       * settlement side (`computeTotals` subtracts `commissionAmount`), so the
       * ledger's payable overstates what they are owed by exactly the commission
       * until that is modelled here too. Left as-is deliberately rather than
       * invented: at a zero rate it changes nothing, and getting it wrong at a
       * non-zero one is worse than leaving it visible.
       */
      entryType: LEDGER_ENTRY_TYPE.COMMISSION,
      amount: pricing?.commissionAmount,
      narration: `Commission on ${brandLabel}`,
    },
  ];

  const entries = [];
  let posted = 0;
  let duplicates = 0;

  for (const item of plan) {
    const result = await recordLedgerEntry({ ...common, ...item });
    if (result.skipped) continue;
    if (result.duplicate) duplicates++;
    else posted++;
    if (result.entry) entries.push(result.entry);
  }

  return { posted, duplicates, entries };
};
