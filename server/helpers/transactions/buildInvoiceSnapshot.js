const {
  formatDuration,
  formatSubscriptionType,
} = require("../subscribeds/formatDuration");
const {
  resolveVendorName,
  resolveDocumentTitle,
} = require("../documents");
const { DOCUMENT_KIND } = require("../../constants/document");
const { GST_TAX_TYPES } = require("../../constants/subscription");
const { PAYMENT_STATUS } = require("../../constants");

/**
 * Build the tax rows.
 *
 * Intra-state supply prints CGST + SGST at half the rate each; inter-state prints
 * a single IGST line — the same split the checkout preview showed the vendor. The
 * rate is worded into the label here rather than at render time, so a document
 * re-issued after the slab changes still shows the rate that was actually charged.
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
 * Assemble the frozen document record for a subscription — bought or granted.
 *
 * The single place a subscription document's printed content is decided, so the
 * paid flow, the admin grant and a re-issue cannot drift into three shapes.
 * Everything the renderer needs ends up here, which is what lets the renderer do
 * no lookups and therefore reproduce an old document exactly.
 *
 * ### What changed, and why
 *
 * This used to return `planName`, `planStart`, `planEnd` and `durationLabel` as
 * top-level fields, and the renderer branched on `kind` to decide how to print
 * them. That branch is gone: the blocks below are already-worded presentation, so
 * a subscription, a grant, a claim, a refund and a payout all reach one renderer.
 *
 * Pure: takes what the caller already has in hand and returns a plain object.
 *
 * @param {object}  args
 * @param {object}  args.transaction   the Transaction (for the number and status)
 * @param {object}  args.subscription  the plan being billed
 * @param {object}  args.pricing       frozen pricing block
 * @param {object}  args.config        getSubscriptionConfig() output — the seller
 * @param {object}  args.billing       buildBillingDetails() output — the buyer
 * @param {object}  args.validity      { startDate, endDate }
 * @param {boolean} [args.isManual]    true for an admin grant
 * @param {string}  [args.paymentMethod]
 * @param {string}  [args.documentNumber] overrides the transaction's own number
 */
exports.buildInvoiceSnapshot = ({
  transaction,
  subscription,
  pricing = {},
  config,
  billing,
  validity,
  isManual = false,
  paymentMethod,
  documentNumber,
}) => {
  /**
   * A grant is its own kind, not a subscription with a flag.
   *
   * It has to say plainly on the paper that nothing was collected through the
   * gateway — a document titled "TAX INVOICE" for a free grant, with no payment
   * against it, is a claim about revenue that never existed.
   */
  const kind = isManual
    ? DOCUMENT_KIND.SUBSCRIPTION_GRANT
    : DOCUMENT_KIND.SUBSCRIPTION;

  // A document with no tax on it must not call itself a tax invoice, and the
  // decision is frozen here — GST may be switched on between issuing this and
  // somebody downloading it.
  const isTaxInvoice = Number(pricing.gstAmount) > 0;

  const number = documentNumber || transaction?.invoiceId;
  const method =
    paymentMethod ||
    transaction?.paymentMethod ||
    transaction?.manualPaymentMode ||
    undefined;

  const planLabel = [
    subscription?.name || "Subscription",
    subscription?.type ? `(${formatSubscriptionType(subscription.type)})` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const durationLabel = formatDuration(
    subscription?.durationInDays,
    subscription?.durationInYears,
  );

  // ---------------- the money rows ----------------
  //
  // Zero rows are omitted, the same rule the checkout summary follows: a
  // `- Rs. 0.00` line suggests something was applied and came to nothing.
  const lineItems = [{ label: "Original Price", amount: pricing.listPrice }];

  if (Number(pricing.discountAmount) > 0) {
    lineItems.push({
      label: pricing.discountPercent
        ? `Plan discount (${pricing.discountPercent}%)`
        : "Plan discount",
      amount: pricing.discountAmount,
      isDeduction: true,
    });
  }

  if (Number(pricing.promoDiscount) > 0) {
    lineItems.push({
      label: pricing.promoCode
        ? `Promo code (${pricing.promoCode})`
        : "Promo code",
      amount: pricing.promoDiscount,
      isDeduction: true,
    });
  }

  lineItems.push({ label: "Taxable Value", amount: pricing.taxableValue });

  // ---------------- what it says about itself ----------------
  const meta = [
    { label: isTaxInvoice ? "Invoice No" : "Receipt No", value: number || "-" },
    {
      label: "Transaction Ref",
      value: transaction?._id ? String(transaction._id) : "-",
    },
    {
      label: "Payment Status",
      value:
        transaction?.status === PAYMENT_STATUS.CAPTURED
          ? "Paid"
          : transaction?.status || "-",
    },
    { label: "Payment Method", value: method || "-" },
  ];

  if (isManual) {
    // A grant's reference is how it is reconciled against a cash book or a bank
    // line; without it the document cannot be tied to anything.
    if (transaction?.referenceNumber) {
      meta.push({ label: "Reference", value: transaction.referenceNumber });
    }
    meta.push({
      label: "Collected",
      value: `Rs. ${Number(transaction?.paidAmount ?? 0).toFixed(2)} of Rs. ${Number(
        pricing.totalPayable ?? 0,
      ).toFixed(2)}`,
    });
  }

  const details = [
    { label: "Plan", value: planLabel },
    ...(durationLabel ? [{ label: "Duration", value: durationLabel }] : []),
  ];
  if (isManual && transaction?.note) {
    details.push({ label: "Note", value: transaction.note });
  }

  /**
   * ⚠️ Real instants, stored as dates and formatted in IST at render time.
   *
   * The vendor asked when they subscribed and when the plan runs out; both have
   * to be the actual moments and both have to still read the same in two years,
   * on a server in another timezone.
   */
  const timeline = [
    { label: "Ordered", at: transaction?.createdAt },
    {
      label: isManual ? "Granted" : "Paid",
      at: transaction?.verifiedAt || transaction?.createdAt,
    },
    { label: "Plan starts", at: validity?.startDate },
    { label: "Plan ends", at: validity?.endDate },
  ].filter((entry) => entry.at);

  // ---------------- the footer ----------------
  const notes = [];
  if (isManual) {
    notes.push(
      Number(transaction?.paidAmount) > 0
        ? "This plan was granted directly by Trydood administration and collected outside the payment gateway."
        : "This plan was granted free of charge by Trydood administration. No payment was collected.",
    );
  }
  if (isTaxInvoice) {
    notes.push(
      pricing.isGstInclusive
        ? "Plan price is inclusive of GST."
        : "GST is charged in addition to the plan price.",
    );
  }

  return {
    version: 2,
    kind,
    title: resolveDocumentTitle({ kind, isTaxInvoice }),
    subtitle: isManual
      ? "Subscription granted by Trydood administration"
      : "Subscription payment receipt",
    isTaxInvoice,
    issuedAt: new Date(),
    documentNumber: number,

    seller: {
      name: config?.companyName,
      legalName: config?.companyName,
      gstin: config?.companyGstin || undefined,
      address: config?.companyAddress || undefined,
      stateCode: config?.companyStateCode || undefined,
      state: config?.companyState || undefined,
    },

    billTo: {
      /**
       * Trading name, else the registered one, else the number we reach them on
       * — carrying a `(Vendor)` tag, exactly as the customer side carries
       * `(Customer)`. A brand named after a person is otherwise indistinguishable
       * from a customer on a printed document, which is the first thing support
       * has to establish.
       */
      name: resolveVendorName({
        brandName: billing?.brandName,
        legalBusinessName: billing?.legalBusinessName,
        whatsappNumber: billing?.whatsappNumber,
      }),
      legalName: billing?.legalBusinessName || undefined,
      gstin: billing?.gstin || undefined,
      pan: billing?.pan || undefined,
      address: billing?.address || undefined,
      stateCode: billing?.stateCode || undefined,
      state: billing?.state || undefined,
      email: billing?.email || undefined,
      contact: billing?.whatsappNumber || undefined,
    },

    // Taken from pricing rather than config: the code that was actually charged
    // against, not whatever the setting says now.
    hsnSacCode: pricing?.hsnSacCode || config?.hsnSacCode,
    placeOfSupply: pricing?.placeOfSupplyState
      ? `${pricing.placeOfSupplyState}${pricing.placeOfSupplyStateCode ? ` (${pricing.placeOfSupplyStateCode})` : ""}`
      : undefined,

    meta,
    details,
    timeline,
    lineItems,
    taxLines: taxLinesFor(pricing),
    total: { label: "Total Payable", amount: pricing.totalPayable },
    notes,

    // Machine-readable, beside the printed blocks rather than instead of them.
    pricing,
    paymentStatus: transaction?.status,
    paymentMethod: method,
    isManual,
  };
};

exports.taxLinesFor = taxLinesFor;
