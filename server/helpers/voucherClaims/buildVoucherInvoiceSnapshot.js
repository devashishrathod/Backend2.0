const {
  INVOICE_KIND,
} = require("../../constants/transaction");

/**
 * Everything a claim invoice prints, frozen at the moment it is issued.
 *
 * The customer twin of `buildInvoiceSnapshot`, and it exists for the same
 * reason: the generator must perform **no lookups**. Everything it needs is in
 * here, so an invoice reproduces byte-for-byte in two years — after the voucher
 * is republished, the brand renamed, the offer deleted, the fee slab changed.
 * Which is also what tax law expects: an issued invoice records what was true
 * then, not a live view.
 *
 * ### The line items are worded here, not in the renderer
 *
 * A claim invoice has to say *"Bill collected on behalf of Cafe Mocha"* rather
 * than name a product. **Trydood did not sell the meal** — the vendor did, and
 * we collected on their behalf. Getting that wording wrong is not a cosmetic
 * problem: an invoice that reads as though we sold the food says we owe tax on
 * ₹1,000 of restaurant revenue.
 *
 * Storing the wording rather than generating it means an invoice re-issued after
 * the wording changes still reads the way it did when it was issued.
 *
 * @param {object} args
 * @param {object} args.transaction
 * @param {object} args.claim
 * @param {object} args.config   `getCustomerConfig()`
 * @param {object} args.seller   the vendor-side company identity
 * @param {object} [args.billTo] the customer, as far as we know them
 */
exports.buildVoucherInvoiceSnapshot = ({
  transaction,
  claim,
  config = {},
  seller = {},
  billTo = {},
}) => {
  const pricing = claim.pricing || {};
  const brandName = claim.brandSnapshot?.name || "the brand";

  /**
   * The rows, in the order they print.
   *
   * Zero rows are omitted, the same rule the checkout summary follows: a
   * `- ₹0.00` line suggests something was applied and came to nothing.
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
      label: `Promo code${pricing.promoCode ? ` (${pricing.promoCode})` : ""}`,
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

  /**
   * A document with no tax on it must not call itself a tax invoice.
   *
   * Decided here and stored, not derived at render time: GST may be switched on
   * between issuing this and someone downloading it, and the document must not
   * change its own title after the fact.
   */
  const isTaxInvoice = Boolean(pricing.isGstEnabled && pricing.gstAmount > 0);

  return {
    version: 1,
    kind: INVOICE_KIND.VOUCHER_CLAIM,
    isTaxInvoice,
    issuedAt: new Date(),
    invoiceId: transaction.invoiceId,
    transactionRef: transaction.razorpayPaymentId || transaction.razorpayOrderId,

    // Trydood's own identity. There is one legal entity, so this comes from the
    // vendor-side config rather than a second copy that could disagree.
    seller: {
      name: seller.companyName,
      gstin: seller.companyGstin,
      address: seller.companyAddress,
      stateCode: seller.companyStateCode,
      state: seller.companyState,
    },
    billTo: {
      name: billTo.name,
      email: billTo.email,
      contact: billTo.contact,
    },

    // Only the SAC of our own fee. The vendor's supply has its own HSN and is
    // not ours to state.
    hsnSacCode: isTaxInvoice ? pricing.sacCode : undefined,

    voucherPricing: pricing,
    lineItems,

    voucherBlock: {
      voucherName: claim.voucherSnapshot?.name,
      versionCode: claim.versionNumber ? `V${claim.versionNumber}` : undefined,
      offerTitle: pricing.offerTitle || undefined,
      claimCode: claim.claimCode,
      outletStoreId: claim.outletSnapshot?.storeId,
      redeemedAt: claim.redeemedAt || claim.paidAt,
    },
    brandBlock: {
      name: brandName,
      outletAddress: claim.outletSnapshot?.state || undefined,
    },

    paymentStatus: transaction.status,
    paymentMethod: transaction.paymentMethod,
    isManual: false,
    // Where the service was consumed — the outlet's state. Recorded even while
    // GST is off, so a claim issued today is unambiguous the day it is on.
    placeOfSupply: pricing.placeOfSupplyState
      ? `${pricing.placeOfSupplyState}${pricing.placeOfSupplyStateCode ? ` (${pricing.placeOfSupplyStateCode})` : ""}`
      : undefined,
  };
};
