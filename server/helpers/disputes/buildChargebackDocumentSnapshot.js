const {
  resolveVendorName,
  resolveDocumentTitle,
} = require("../documents");
const { DOCUMENT_KIND } = require("../../constants/document");

/**
 * Everything a chargeback advice prints, frozen when the dispute is lost.
 *
 * ### Why a lost dispute needs a document at all
 *
 * It produced **nothing**. The vendor's next payout simply came out lower, with a
 * "chargebacks recovered" line on the statement and nothing behind it — no claim
 * code, no date, no reason, no amount they could check. The first they knew was
 * money missing, and the only way to find out why was to ask.
 *
 * ### Issued at `LOST`, not at recovery
 *
 * The deduction lands one or more cycles later. Telling the vendor when it
 * happens rather than when the money goes means they are not surprised, and the
 * settlement statement can reference this number so a deduction traces back to
 * the sale it came from.
 *
 * ### Credit note, debit note, or advice
 *
 * Under GST a recovery from a vendor against a tax invoice is a **debit note**;
 * with no tax on the original it is simply an advice. `resolveDocumentTitle`
 * decides from what was actually charged, so the same code covers both sides of
 * the GST switch with nothing to rewrite on the day it is flipped.
 *
 * @param {object} args
 * @param {object} args.dispute
 * @param {object} args.transaction    the payment the bank pulled back
 * @param {object} [args.claim]        the claim it paid for, when there is one
 * @param {object} args.brand
 * @param {object} args.billing        buildBillingDetails() — the vendor's identity
 * @param {object} args.seller         getSubscriptionConfig() — Trydood
 * @param {string} args.documentNumber
 */
exports.buildChargebackDocumentSnapshot = ({
  dispute,
  transaction = {},
  claim,
  brand = {},
  billing = {},
  seller = {},
  documentNumber,
}) => {
  const original = transaction.invoiceSnapshot || {};
  const voucher = transaction.voucher || {};

  /**
   * A recovery inherits the tax character of what it reverses — read off the
   * **original document**, not today's config. A chargeback on a payment taken
   * before GST was switched on is not a debit note just because GST is on now.
   */
  const isTaxInvoice = Boolean(original.isTaxInvoice);

  /**
   * What the vendor actually loses.
   *
   * Their share of the sale, not the bill the customer paid: the convenience fee
   * and our commission were never theirs. `vendorPayable` is the frozen figure
   * the settlement would have paid them, which is exactly what is being taken
   * back. The bank's own figure is printed beside it so the two can be compared —
   * a partial chargeback is not unusual and the difference has to be visible.
   */
  const recoverable = Number(voucher.vendorPayable) || 0;
  const disputedAmount = Number(dispute.amount) || 0;

  const lineItems = [
    { label: "Bill amount on the disputed payment", amount: voucher.billAmount },
    {
      label: "Less: Trydood convenience fee and commission (never yours)",
      amount: Math.max(0, (Number(voucher.billAmount) || 0) - recoverable),
      isDeduction: true,
    },
  ];

  const meta = [
    {
      label: isTaxInvoice ? "Debit Note No" : "Advice No",
      value: documentNumber || "-",
    },
    // The one line that lets a deduction be traced back to a sale.
    {
      label: "Against Receipt",
      value: original.documentNumber || transaction.invoiceId || "-",
    },
    { label: "Claim Code", value: voucher.claimCode || claim?.claimCode || "-" },
    { label: "Dispute Ref", value: dispute.disputeId || "-" },
    { label: "Amount disputed by the bank", value: String(disputedAmount) },
  ];

  const details = [
    { label: "Reason given by the bank", value: dispute.reason || "Not stated" },
    ...(dispute.reasonCode
      ? [{ label: "Reason code", value: dispute.reasonCode }]
      : []),
    ...(dispute.phase ? [{ label: "Stage", value: dispute.phase }] : []),
    ...(claim?.voucherSnapshot?.name
      ? [{ label: "Voucher", value: claim.voucherSnapshot.name }]
      : []),
    ...(claim?.outletSnapshot?.storeId
      ? [{ label: "Outlet", value: claim.outletSnapshot.storeId }]
      : []),
  ];

  /**
   * ⚠️ Real instants. "When was the sale, when did the bank raise it, when did we
   * lose" are three different dates, and a vendor checking this against their own
   * records needs all three.
   */
  const timeline = [
    { label: "Payment taken", at: transaction.verifiedAt },
    { label: "Dispute raised", at: dispute.openedAt },
    { label: "Response deadline", at: dispute.respondBy },
    { label: "Lost", at: dispute.resolvedAt },
  ].filter((entry) => entry.at);

  return {
    version: 2,
    kind: DOCUMENT_KIND.CHARGEBACK,
    title: resolveDocumentTitle({
      kind: DOCUMENT_KIND.CHARGEBACK,
      isTaxInvoice,
    }),
    subtitle:
      "The customer's bank reversed this payment. The amount below will be recovered from a future payout.",
    isTaxInvoice,
    issuedAt: new Date(),
    documentNumber,

    seller: {
      name: seller.companyName,
      gstin: seller.companyGstin,
      address: seller.companyAddress,
      state: seller.companyState,
      stateCode: seller.companyStateCode,
    },
    billTo: {
      name: resolveVendorName({
        brandName: brand.brandName,
        legalBusinessName: brand.legalBusinessName,
        whatsappNumber: billing.whatsappNumber,
      }),
      legalName: brand.legalBusinessName,
      gstin: billing.gstin,
      address: billing.address,
      state: billing.state,
      stateCode: billing.stateCode,
    },
    placeOfSupply: original.placeOfSupply,

    meta,
    details,
    timeline,
    lineItems,
    taxLines: [],
    total: { label: "Recoverable from your payouts", amount: recoverable },
    notes: [
      "This amount has not been taken yet. It will be deducted from a future payout, and that payout's statement will name this advice.",
      "A chargeback is decided by the customer's bank, not by Trydood. Where we can contest one we do, using the outlet's evidence alongside our own records.",
      ...(disputedAmount && Math.abs(disputedAmount - recoverable) > 0.01
        ? [
            "The bank disputed a different amount to the one recoverable from you — the difference is the Trydood fee and commission on that sale, which was never yours and is absorbed by us.",
          ]
        : []),
    ],

    paymentStatus: dispute.status,
    paymentMethod: transaction.paymentMethod,
    isManual: true,
  };
};
