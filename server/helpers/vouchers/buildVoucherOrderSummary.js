const { GST_TAX_TYPES } = require("../../constants/subscription");
const { VOUCHER_SUMMARY_ROWS } = require("../../constants/voucher");
const { CUSTOMER_CURRENCY_DEFAULTS } = require("../../constants/customer");
const {
  formatMoney,
  formatPercent,
} = require("../subscribeds/buildOrderSummary");

/**
 * Tax rows for the convenience fee.
 *
 * ⚠️ Returns **nothing** when GST is off, which is the default. The vendor twin
 * always emits a tax row because a subscription is always taxed; a claim is not.
 * `taxType` is null while GST is disabled precisely so this can tell the
 * difference — printing "IGST @ 0.00%  ₹ 0.00" on an invoice that carries no tax
 * is worse than printing nothing, because it reads as a tax that was charged.
 *
 * Intra-state supply shows two half-rate lines, inter-state one. The label
 * itself changes, not just the amount.
 */
const buildTaxRows = (pricing, symbol) => {
  if (!pricing.isGstEnabled || !pricing.taxType || !pricing.gstAmount) {
    return [];
  }

  // Named so the customer knows what was taxed. "IGST @ 18%" on its own reads
  // as tax on the whole bill, which would be alarming and wrong.
  const on = "on convenience fee";

  if (pricing.taxType === GST_TAX_TYPES.CGST_SGST) {
    const half = pricing.gstPercentage / 2;
    return [
      {
        key: VOUCHER_SUMMARY_ROWS.TAX,
        label: `CGST @ ${formatPercent(half)} ${on}`,
        amount: pricing.cgst,
        display: formatMoney(pricing.cgst, symbol),
      },
      {
        key: VOUCHER_SUMMARY_ROWS.TAX,
        label: `SGST @ ${formatPercent(half)} ${on}`,
        amount: pricing.sgst,
        display: formatMoney(pricing.sgst, symbol),
      },
    ];
  }

  return [
    {
      key: VOUCHER_SUMMARY_ROWS.TAX,
      label: `IGST @ ${formatPercent(pricing.gstPercentage)} ${on}`,
      amount: pricing.igst,
      display: formatMoney(pricing.igst, symbol),
    },
  ];
};

/**
 * Turn a voucher pricing block into the exact rows a claim checkout renders.
 *
 * The customer twin of `buildOrderSummary`. Same contract: **the client does no
 * arithmetic and builds no labels.** If the fee slab, the GST rate or the place
 * of supply changes, only this file and the config change, and every screen
 * follows.
 *
 * ### Why the rows are not the subscription's rows
 *
 * A subscription starts from a list price the platform set. A claim starts from
 * a bill the customer typed at a counter, gets a vendor's discount, then has
 * Trydood's own fee added. "Original Price" would be a strange thing to call a
 * number the customer just entered, and "Bill Value" means the taxable subtotal
 * on the vendor side but the amount owed to the restaurant here. Reusing the
 * labels would have made both screens harder to read.
 *
 * ### Zero rows are omitted
 *
 * A `- ₹ 0.00` line is noise, and worse, it suggests something was applied and
 * came to nothing. The exception is `Bill Amount`, which is always shown because
 * it anchors everything below it.
 *
 * @param {object} pricing  a `voucherPricingSchema` block from `calculateVoucherPricing`
 * @param {object} [config] `getCustomerConfig()` — only the currency is read
 */
exports.buildVoucherOrderSummary = (pricing = {}, config = {}) => {
  const symbol =
    config.currencySymbol || CUSTOMER_CURRENCY_DEFAULTS.currencySymbol;

  const rows = [
    {
      key: VOUCHER_SUMMARY_ROWS.BILL_AMOUNT,
      label: "Bill Amount",
      amount: pricing.billAmount,
      display: formatMoney(pricing.billAmount, symbol),
    },
  ];

  if (pricing.offerDiscount > 0) {
    rows.push({
      key: VOUCHER_SUMMARY_ROWS.OFFER_DISCOUNT,
      // The offer's own title when it has one — "Weekend 20% off" tells the
      // customer which of several offers they got, which a generic label cannot.
      label: pricing.offerTitle
        ? `Voucher discount (${pricing.offerTitle})`
        : "Voucher discount",
      amount: -pricing.offerDiscount,
      display: `- ${formatMoney(pricing.offerDiscount, symbol)}`,
    });
  }

  if (pricing.promoDiscount > 0) {
    rows.push({
      key: VOUCHER_SUMMARY_ROWS.PROMO_DISCOUNT,
      label: `Promo code${pricing.promoCode ? ` (${pricing.promoCode})` : ""}`,
      amount: -pricing.promoDiscount,
      display: `- ${formatMoney(pricing.promoDiscount, symbol)}`,
    });
  }

  // The running subtotal, shown only when a discount has actually moved it.
  // With no discount it would repeat the bill amount immediately above it.
  if (pricing.offerDiscount > 0 || pricing.promoDiscount > 0) {
    rows.push({
      key: VOUCHER_SUMMARY_ROWS.NET_BILL,
      label: "Bill after discount",
      amount: pricing.netBill,
      display: formatMoney(pricing.netBill, symbol),
    });
  }

  if (pricing.convenienceFee > 0) {
    rows.push({
      key: VOUCHER_SUMMARY_ROWS.CONVENIENCE_FEE,
      label: "Convenience fee",
      amount: pricing.convenienceFee,
      display: `+ ${formatMoney(pricing.convenienceFee, symbol)}`,
    });
  }

  rows.push(...buildTaxRows(pricing, symbol));

  return {
    rows,
    payable: {
      label: "You'll Pay",
      amount: pricing.totalPayable,
      display: formatMoney(pricing.totalPayable, symbol),
    },
    youSaved: pricing.youSaved,
    youSavedDisplay: formatMoney(pricing.youSaved, symbol),
    // Empty rather than a "You saved ₹ 0.00" banner, so a screen can render the
    // savings strip only when there is something to celebrate.
    savedText:
      pricing.youSaved > 0
        ? `You saved ${formatMoney(pricing.youSaved, symbol)} on this bill`
        : null,
  };
};
