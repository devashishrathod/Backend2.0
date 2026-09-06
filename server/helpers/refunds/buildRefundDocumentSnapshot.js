const {
  resolveCustomerName,
  resolveDocumentTitle,
} = require("../documents");
const { DOCUMENT_KIND } = require("../../constants/document");
const { REFUND_REASON } = require("../../constants/refund");
const { REFUND_METHODS } = require("../../constants/customer");

/**
 * What each refund reason says on paper.
 *
 * The enum value is for code; a customer holding the document reads this. Worded
 * here and frozen into the snapshot so a re-issue years later still gives the
 * reason the refund was actually granted for, not whatever the wording has since
 * become.
 */
const REASON_TEXT = Object.freeze({
  [REFUND_REASON.NOT_HONOURED]: "The outlet did not honour the voucher",
  [REFUND_REASON.OUTLET_CLOSED]: "The outlet was closed",
  [REFUND_REASON.WRONG_AMOUNT]: "The bill amount was wrong",
  [REFUND_REASON.SERVICE_ISSUE]: "Service issue at the outlet",
  [REFUND_REASON.DUPLICATE_PAYMENT]: "Duplicate payment",
  [REFUND_REASON.CHANGED_MIND]: "Cancelled before use",
  [REFUND_REASON.OTHER]: "Other",
});

const METHOD_TEXT = Object.freeze({
  [REFUND_METHODS.SOURCE]: "Back to the original payment method",
  [REFUND_METHODS.MANUAL_BANK]: "Bank transfer (NEFT)",
});

/**
 * Everything a refund document prints, frozen at the moment it is issued.
 *
 * ### Why a refund needed its own document at all
 *
 * It produced **nothing**. A customer got a push and an email saying money was on
 * its way, and no paper — while the payment that created the claim had a full
 * receipt with a number on it. When the money did not appear three days later,
 * they had nothing to show their bank and nothing to quote at support.
 *
 * ### Why it is generic across the GST switch
 *
 * Under GST a refund against a **tax invoice** is a credit note; against an
 * untaxed receipt it is simply a refund receipt. `resolveDocumentTitle` picks
 * from `isTaxInvoice`, which is read off what was *actually charged* on the
 * original — so the same code produces the right document before and after
 * customer GST is switched on, with nothing to rewrite on the day it is.
 *
 * ### Why it names the original
 *
 * A credit note with no reference to the invoice it reverses cannot be
 * reconciled by anybody — not the customer, not an accountant, not us. The
 * original's number goes in the meta block, and the claim it belongs to with it.
 *
 * @param {object} args
 * @param {object} args.refundRequest  the completed request
 * @param {object} args.claim          the claim being refunded
 * @param {object} args.transaction    the original payment
 * @param {object} args.seller         the vendor-side company identity
 * @param {string} args.documentNumber the allotted number
 * @param {string} [args.utr]          bank reference, when there is one
 */
exports.buildRefundDocumentSnapshot = ({
  refundRequest,
  claim = {},
  transaction = {},
  seller = {},
  documentNumber,
  utr,
}) => {
  const split = refundRequest.split || {};
  const original = transaction.invoiceSnapshot || {};
  const customer = claim.customerSnapshot || {};
  const brandName = claim.brandSnapshot?.name || "the brand";

  /**
   * A refund inherits the tax character of what it reverses.
   *
   * Read off the **original document**, not off today's config: a refund of a
   * payment taken before GST was switched on is not a credit note just because
   * GST is on now. If the original has no snapshot to read, fall back to whether
   * the claim's own pricing carried tax.
   */
  const isTaxInvoice = Boolean(
    original.isTaxInvoice ?? (claim.pricing?.isGstEnabled && claim.pricing?.gstAmount > 0),
  );

  /**
   * The rows, in the order they print. Zero rows are omitted — a `Rs. 0.00` line
   * suggests something was returned and came to nothing.
   *
   * Every part is named separately because "why is my refund ₹1,600 and not
   * ₹1,620" is the whole reason a customer opens this document. On a partial
   * refund the convenience fee is not returned, and the paper has to say so
   * rather than leave them to work it out.
   */
  const lineItems = [];
  if (Number(split.netBillRefund) > 0) {
    lineItems.push({
      label: `Bill refunded (collected on behalf of ${brandName})`,
      amount: split.netBillRefund,
    });
  }
  if (Number(split.convenienceFeeRefund) > 0) {
    lineItems.push({
      label: "Convenience fee refunded (Trydood)",
      amount: split.convenienceFeeRefund,
    });
  }

  const taxLines =
    isTaxInvoice && Number(split.taxRefund) > 0
      ? [{ label: "Tax refunded on the convenience fee", amount: split.taxRefund }]
      : [];

  const meta = [
    {
      label: isTaxInvoice ? "Credit Note No" : "Refund No",
      value: documentNumber || "-",
    },
    // The one line that makes this reconcilable against anything.
    {
      label: isTaxInvoice ? "Against Invoice" : "Against Receipt",
      value: original.documentNumber || transaction.invoiceId || "-",
    },
    { label: "Claim Code", value: claim.claimCode || refundRequest.claimCode || "-" },
    {
      label: "Refund Method",
      value: METHOD_TEXT[refundRequest.method] || refundRequest.method || "-",
    },
  ];

  /**
   * The bank reference, and the reason it is on the paper.
   *
   * Three days after a customer says the money never arrived, the UTR is the only
   * thing their bank can look up. Printing it here means they already have it
   * rather than having to ask support for it.
   */
  const reference = utr || refundRequest.utr || refundRequest.razorpayRefundId;
  if (reference) {
    meta.push({
      label: refundRequest.method === REFUND_METHODS.MANUAL_BANK ? "UTR" : "Refund Ref",
      value: reference,
    });
  }

  const details = [
    {
      label: "Reason",
      value: REASON_TEXT[refundRequest.reason] || refundRequest.reason || "-",
    },
  ];
  if (refundRequest.reasonNote) {
    details.push({ label: "Details", value: refundRequest.reasonNote });
  }
  if (claim.voucherSnapshot?.name) {
    details.push({ label: "Voucher", value: claim.voucherSnapshot.name });
  }
  if (claim.outletSnapshot?.storeId) {
    details.push({ label: "Outlet", value: claim.outletSnapshot.storeId });
  }

  /**
   * ⚠️ Real instants, stored as dates and rendered in IST.
   *
   * "When did I ask, when was it approved, when did it actually go out" is
   * exactly what a customer chasing a refund needs, and each is a different day.
   */
  const timeline = [
    { label: "Paid originally", at: claim.paidAt },
    { label: "Refund requested", at: refundRequest.createdAt },
    {
      label: "Approved",
      at: refundRequest.adminDecisionAt || refundRequest.vendorDecisionAt,
    },
    { label: "Refunded", at: refundRequest.completedAt },
  ].filter((entry) => entry.at);

  const notes = [
    split.isFullRefund
      ? "This is a full refund of the amount paid."
      : "This is a partial refund. The convenience fee is returned only on a full refund.",
  ];
  notes.push(
    isTaxInvoice
      ? "Tax shown was charged on the Trydood convenience fee only and is returned with it."
      : "No tax was charged on the original payment, so none is returned.",
  );
  notes.push(
    "The bill amount was collected on behalf of the brand and has been returned to you.",
  );

  return {
    version: 2,
    kind: DOCUMENT_KIND.REFUND,
    title: resolveDocumentTitle({ kind: DOCUMENT_KIND.REFUND, isTaxInvoice }),
    subtitle: `Refund of a payment collected by Trydood on behalf of ${brandName}`,
    isTaxInvoice,
    issuedAt: new Date(),
    documentNumber,

    // One legal entity, so the seller identity is the same block every other
    // Trydood document carries.
    seller: {
      name: seller.companyName,
      gstin: seller.companyGstin,
      address: seller.companyAddress,
      stateCode: seller.companyStateCode,
      state: seller.companyState,
    },

    billTo: {
      name: resolveCustomerName({
        fullName: customer.name,
        whatsappNumber: customer.whatsappNumber || transaction.contact,
        mobile: customer.mobile,
      }),
      email: customer.email || transaction.email,
      contact: customer.whatsappNumber || customer.mobile || transaction.contact,
    },

    // Carried over from the original — a credit note states the same place of
    // supply as the document it reverses, not wherever the customer is now.
    placeOfSupply: original.placeOfSupply,
    hsnSacCode: isTaxInvoice ? original.hsnSacCode : undefined,

    meta,
    details,
    timeline,
    lineItems,
    taxLines,
    total: { label: "Total Refunded", amount: split.totalRefund },
    notes,

    paymentStatus: refundRequest.status,
    paymentMethod: refundRequest.method,
    isManual: refundRequest.method === REFUND_METHODS.MANUAL_BANK,
  };
};

exports.REFUND_REASON_TEXT = REASON_TEXT;
exports.REFUND_METHOD_TEXT = METHOD_TEXT;
