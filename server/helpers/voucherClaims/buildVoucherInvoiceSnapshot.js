const {
  resolveCustomerName,
  resolveDocumentTitle,
} = require("../documents");
const { DOCUMENT_KIND } = require("../../constants/document");
const { GST_TAX_TYPES } = require("../../constants/subscription");
const { PAYMENT_STATUS } = require("../../constants");

/**
 * The tax rows for a claim.
 *
 * ⚠️ Any tax here is on **Trydood's convenience fee alone**. The bill was
 * collected on behalf of the brand and is not our supply, so it carries no tax
 * from us. The rate is worded into the label so a document re-issued after the
 * slab changes still shows the rate that was actually charged.
 */
const taxLinesFor = (pricing = {}) => {
  const rate = Number(pricing.gstPercentage) || 0;
  if (!rate) return [];

  if (pricing.taxType === GST_TAX_TYPES.CGST_SGST) {
    return [
      { label: `CGST @ ${(rate / 2).toFixed(2)}%`, amount: pricing.cgst },
      { label: `SGST @ ${(rate / 2).toFixed(2)}%`, amount: pricing.sgst },
    ];
  }
  return [{ label: `IGST @ ${rate.toFixed(2)}%`, amount: pricing.igst }];
};

/**
 * Everything a claim document prints, frozen at the moment it is issued.
 *
 * The customer twin of `buildInvoiceSnapshot`, and it exists for the same reason:
 * the renderer must perform **no lookups**. Everything it needs is in here, so a
 * document reproduces in two years — after the voucher is republished, the brand
 * renamed, the offer deleted, the fee slab changed. Which is also what tax law
 * expects: an issued document records what was true then, not a live view.
 *
 * ### The line items are worded here, not in the renderer
 *
 * A claim document has to say *"Bill collected on behalf of Cafe Mocha"* rather
 * than name a product. **Trydood did not sell the meal** — the vendor did, and we
 * collected on their behalf. Getting that wording wrong is not cosmetic: a
 * document that reads as though we sold the food says we owe tax on ₹1,000 of
 * restaurant revenue.
 *
 * Storing the wording rather than generating it means a document re-issued after
 * the wording changes still reads the way it did when it was issued.
 *
 * @param {object} args
 * @param {object} args.transaction
 * @param {object} args.claim
 * @param {object} args.config   `getCustomerConfig()`
 * @param {object} args.seller   the vendor-side company identity
 * @param {object} [args.billTo] the customer, as far as we know them
 * @param {string} [args.documentNumber] overrides the transaction's own number
 */
exports.buildVoucherInvoiceSnapshot = ({
  transaction,
  claim,
  config = {},
  seller = {},
  billTo = {},
  documentNumber,
}) => {
  const pricing = claim.pricing || {};
  const brandName = claim.brandSnapshot?.name || "the brand";
  const customer = claim.customerSnapshot || {};
  const number = documentNumber || transaction.invoiceId;

  /**
   * A document with no tax on it must not call itself a tax invoice.
   *
   * Decided here and stored, not derived at render time: GST may be switched on
   * between issuing this and someone downloading it, and the document must not
   * change its own title after the fact.
   */
  const isTaxInvoice = Boolean(pricing.isGstEnabled && pricing.gstAmount > 0);

  /**
   * The rows, in the order they print.
   *
   * Zero rows are omitted, the same rule the checkout summary follows: a
   * `- Rs. 0.00` line suggests something was applied and came to nothing.
   */
  const lineItems = [
    {
      // Names the brand, and says plainly who the money was for.
      label: `Bill collected on behalf of ${brandName}`,
      amount: pricing.billAmount,
    },
  ];

  if (pricing.offerDiscount > 0) {
    lineItems.push({
      label: pricing.offerTitle
        ? `Voucher discount (${pricing.offerTitle})`
        : "Voucher discount",
      amount: pricing.offerDiscount,
      isDeduction: true,
    });
  }

  if (pricing.promoDiscount > 0) {
    lineItems.push({
      label: pricing.promoCode
        ? `Promo code (${pricing.promoCode})`
        : "Promo code",
      amount: pricing.promoDiscount,
      isDeduction: true,
    });
  }

  if (pricing.convenienceFee > 0) {
    lineItems.push({
      // The one line that is genuinely Trydood's own supply, and the only line
      // any tax on this document relates to.
      label: "Convenience fee (Trydood)",
      amount: pricing.convenienceFee,
    });
  }

  // ---------------- what it says about itself ----------------
  const meta = [
    { label: isTaxInvoice ? "Invoice No" : "Receipt No", value: number || "-" },
    {
      label: "Payment Ref",
      value: transaction.razorpayPaymentId || transaction.razorpayOrderId || "-",
    },
    {
      label: "Payment Status",
      value:
        transaction.status === PAYMENT_STATUS.CAPTURED
          ? "Paid"
          : transaction.status || "-",
    },
    { label: "Payment Method", value: transaction.paymentMethod || "-" },
  ];

  // ---------------- what was claimed ----------------
  const details = [];
  if (claim.voucherSnapshot?.name) {
    details.push({ value: claim.voucherSnapshot.name });
  }
  if (pricing.offerTitle) details.push({ label: "Offer", value: pricing.offerTitle });
  if (claim.claimCode) details.push({ label: "Claim Code", value: claim.claimCode });
  if (claim.outletSnapshot?.storeId) {
    details.push({ label: "Outlet", value: claim.outletSnapshot.storeId });
  }
  if (claim.versionNumber) {
    details.push({ label: "Voucher Version", value: `V${claim.versionNumber}` });
  }

  /**
   * ⚠️ Real instants, stored as dates and formatted in IST at render time.
   *
   * A customer asking "when did I claim this, and when did I pay" has to get the
   * actual moments — and the same moments every time they open the link, on
   * whatever server renders it. `createdAt` is when the claim was opened, which is
   * not the same as when it was paid, and neither is when it was redeemed.
   */
  const timeline = [
    { label: "Claimed", at: claim.createdAt },
    { label: "Paid", at: claim.paidAt || transaction.verifiedAt },
    { label: "Redeemed", at: claim.redeemedAt },
  ].filter((entry) => entry.at);

  return {
    version: 2,
    kind: DOCUMENT_KIND.VOUCHER_CLAIM,
    title: resolveDocumentTitle({
      kind: DOCUMENT_KIND.VOUCHER_CLAIM,
      isTaxInvoice,
    }),
    subtitle: `Payment collected by Trydood on behalf of ${brandName}`,
    isTaxInvoice,
    issuedAt: new Date(),
    documentNumber: number,

    // Trydood's own identity. There is one legal entity, so this comes from the
    // vendor-side config rather than a second copy that could disagree.
    seller: {
      name: seller.companyName,
      gstin: seller.companyGstin,
      address: seller.companyAddress,
      stateCode: seller.companyStateCode,
      state: seller.companyState,
    },

    /**
     * Who paid.
     *
     * ⚠️ This used to be `billTo.name` alone, fed from `claim.customerSnapshot`
     * — a field that did not exist on the model, so **every** receipt printed
     * `Bill To: -`. The name now cascades (name, then the number we reach them
     * on, then the bare word) because `fullName` is optional, and it carries a
     * `(Customer)` tag so a document is never ambiguous about which side of the
     * business it belongs to.
     */
    billTo: {
      name: resolveCustomerName({
        fullName: billTo.name || customer.name,
        whatsappNumber: customer.whatsappNumber || billTo.contact,
        mobile: customer.mobile,
      }),
      email: billTo.email || customer.email,
      contact: billTo.contact || customer.whatsappNumber || customer.mobile,
    },

    // Only the SAC of our own fee, and only on a document that carries tax. The
    // vendor's supply has its own HSN and is not ours to state.
    hsnSacCode: isTaxInvoice ? pricing.sacCode : undefined,
    // Where the service was consumed — the outlet's state. Recorded even while
    // GST is off, so a claim issued today is unambiguous the day it is on.
    placeOfSupply: pricing.placeOfSupplyState
      ? `${pricing.placeOfSupplyState}${pricing.placeOfSupplyStateCode ? ` (${pricing.placeOfSupplyStateCode})` : ""}`
      : undefined,

    meta,
    details,
    timeline,
    lineItems,
    taxLines: isTaxInvoice ? taxLinesFor(pricing) : [],
    total: { label: "You Paid", amount: pricing.totalPayable },
    /**
     * A claim's footer has to say three things a subscription's does not: that
     * Trydood collected rather than sold, that any tax here is on our fee alone,
     * and — while GST is off — that there is no tax at all.
     */
    notes: [
      isTaxInvoice
        ? "Tax shown applies to the Trydood convenience fee only. The bill amount was collected on behalf of the brand."
        : "No tax has been charged. The bill amount was collected on behalf of the brand.",
    ],

    // Machine-readable, beside the printed blocks rather than instead of them.
    voucherPricing: pricing,
    paymentStatus: transaction.status,
    paymentMethod: transaction.paymentMethod,
    isManual: false,
  };
};

exports.taxLinesFor = taxLinesFor;
