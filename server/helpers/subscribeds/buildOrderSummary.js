const {
  ORDER_SUMMARY_ROWS,
  GST_TAX_TYPES,
} = require("../../constants/subscription");

// "₹ 5,898.82" — Indian digit grouping, always two decimals, so the checkout
// page never has to format or round anything itself.
const formatMoney = (amount, symbol = "₹") =>
  `${symbol} ${Number(amount || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// 18 -> "18.00%", 9 -> "9.00%" — matches the "IGST @ 18.00%" row label.
const formatPercent = (value) => `${(Number(value) || 0).toFixed(2)}%`;

/**
 * Build the tax rows. Intra-state supply is shown as two half-rate lines,
 * inter-state as one — the label itself changes, not just the amount.
 */
const buildTaxRows = (pricing, symbol) => {
  const half = pricing.gstPercentage / 2;

  if (pricing.taxType === GST_TAX_TYPES.CGST_SGST) {
    return [
      {
        key: ORDER_SUMMARY_ROWS.TAX,
        label: `CGST @ ${formatPercent(half)}`,
        amount: pricing.cgst,
        display: formatMoney(pricing.cgst, symbol),
      },
      {
        key: ORDER_SUMMARY_ROWS.TAX,
        label: `SGST @ ${formatPercent(half)}`,
        amount: pricing.sgst,
        display: formatMoney(pricing.sgst, symbol),
      },
    ];
  }

  return [
    {
      key: ORDER_SUMMARY_ROWS.TAX,
      label: `IGST @ ${formatPercent(pricing.gstPercentage)}`,
      amount: pricing.igst,
      display: formatMoney(pricing.igst, symbol),
    },
  ];
};

/**
 * Turn a pricing block into the exact rows the checkout "Order Summary" panel
 * renders, top to bottom.
 *
 * The frontend does no arithmetic and no label building: if the GST rate, the
 * discount or the place of supply changes, only this file and the config change
 * and the page follows automatically.
 */
exports.buildOrderSummary = (pricing, config = {}) => {
  const symbol = config.currencySymbol || "₹";
  const rows = [
    {
      key: ORDER_SUMMARY_ROWS.ORIGINAL_PRICE,
      label: "Original Price",
      amount: pricing.listPrice,
      display: formatMoney(pricing.listPrice, symbol),
    },
  ];

  // Only shown when there is something to show — a "- ₹ 0.00" line is noise.
  if (pricing.discountAmount > 0) {
    rows.push({
      key: ORDER_SUMMARY_ROWS.DISCOUNT,
      label:
        pricing.discountPercent > 0
          ? `Discount (${formatPercent(pricing.discountPercent)} off)`
          : "Discount",
      amount: -pricing.discountAmount,
      display: `- ${formatMoney(pricing.discountAmount, symbol)}`,
    });
  }

  if (pricing.promoDiscount > 0) {
    rows.push({
      key: ORDER_SUMMARY_ROWS.PROMO_DISCOUNT,
      label: `Promo code${pricing.promoCode ? ` (${pricing.promoCode})` : ""}`,
      amount: -pricing.promoDiscount,
      display: `- ${formatMoney(pricing.promoDiscount, symbol)}`,
    });
  }

  rows.push({
    key: ORDER_SUMMARY_ROWS.BILL_VALUE,
    label: "Bill Value",
    amount: pricing.taxableValue,
    display: formatMoney(pricing.taxableValue, symbol),
  });

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
    savedText: `You saved ${formatMoney(pricing.youSaved, symbol)} on This Plan`,
  };
};

exports.formatMoney = formatMoney;
exports.formatPercent = formatPercent;
