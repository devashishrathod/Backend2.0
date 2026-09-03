const {
  formatDuration,
  formatSubscriptionType,
} = require("../subscribeds/formatDuration");

/**
 * Assemble the frozen invoice record.
 *
 * The single place an invoice's printed content is decided, so the paid flow and
 * the admin grant cannot produce differently-shaped invoices. Everything the
 * generator needs ends up here, which is what lets the generator itself do no
 * lookups — and therefore reproduce an old invoice exactly.
 *
 * Pure: takes what the caller already has in hand and returns a plain object.
 *
 * @param {object}  args
 * @param {object}  args.transaction   the Transaction (for invoiceId, status)
 * @param {object}  args.subscription  the plan being billed
 * @param {object}  args.pricing       frozen pricing block
 * @param {object}  args.config        getSubscriptionConfig() output — the seller
 * @param {object}  args.billing       buildBillingDetails() output — the buyer
 * @param {object}  args.validity      { startDate, endDate }
 * @param {boolean} [args.isManual]    true for an admin grant
 * @param {string}  [args.paymentMethod]
 */
exports.buildInvoiceSnapshot = ({
  transaction,
  subscription,
  pricing,
  config,
  billing,
  validity,
  isManual = false,
  paymentMethod,
}) => ({
  version: 1,
  issuedAt: new Date(),
  invoiceId: transaction?.invoiceId,
  transactionRef: transaction?._id ? String(transaction._id) : undefined,

  planName: subscription?.name,
  planType: subscription?.type
    ? formatSubscriptionType(subscription.type)
    : undefined,
  durationLabel: formatDuration(
    subscription?.durationInDays,
    subscription?.durationInYears,
  ),
  planStart: validity?.startDate,
  planEnd: validity?.endDate,
  // Taken from pricing rather than config: the code that was actually charged
  // against, not whatever the setting says now.
  hsnSacCode: pricing?.hsnSacCode || config?.hsnSacCode,

  seller: {
    name: config?.companyName,
    legalName: config?.companyName,
    gstin: config?.companyGstin || undefined,
    address: config?.companyAddress || undefined,
    stateCode: config?.companyStateCode || undefined,
    state: config?.companyState || undefined,
  },

  billTo: {
    name: billing?.brandName,
    legalName: billing?.legalBusinessName,
    gstin: billing?.gstin || undefined,
    pan: billing?.pan || undefined,
    address: billing?.address || undefined,
    stateCode: billing?.stateCode || undefined,
    state: billing?.state || undefined,
    email: billing?.email || undefined,
    contact: billing?.whatsappNumber || undefined,
  },

  pricing,

  paymentStatus: transaction?.status,
  paymentMethod:
    paymentMethod ||
    transaction?.paymentMethod ||
    transaction?.manualPaymentMode ||
    undefined,
  isManual,
  // Printed on the invoice; derived once here so the generator does not have to
  // decide how to phrase it.
  placeOfSupply: pricing?.placeOfSupplyState
    ? `${pricing.placeOfSupplyState}${pricing.placeOfSupplyStateCode ? ` (${pricing.placeOfSupplyStateCode})` : ""}`
    : undefined,
});
