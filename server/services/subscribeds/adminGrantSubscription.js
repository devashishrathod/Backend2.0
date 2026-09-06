const crypto = require("crypto");
const Brand = require("../../models/Brand");
const Subscription = require("../../models/Subscription");
const Transaction = require("../../models/Transaction");
const { PAYMENT_STATUS } = require("../../constants");
const {
  PAYMENT_GATEWAYS,
  MANUAL_PAYMENT_MODES,
  SUBSCRIPTION_SOURCE,
  SUBSCRIPTION_ACTION,
} = require("../../constants/subscription");
const {
  TRANSACTION_PURPOSE,
  ACCOUNT_FOR_PURPOSE,
} = require("../../constants/transaction");
const {
  DOCUMENT_KIND,
  DOCUMENT_SERIES,
} = require("../../constants/document");
const { throwError } = require("../../utils");
const { getSubscriptionConfig } = require("../../helpers/settings");
const { summarizeUsage } = require("../../helpers/brands");
const {
  calculateEndDate,
  calculatePricing,
  buildBillingDetails,
  buildOrderSummary,
  getActiveSubscription,
  resolveSubscriptionAction,
  activateSubscription,
} = require("../../helpers/subscribeds");
const { buildInvoiceSnapshot } = require("../../helpers/transactions");
const { generateDocumentNumber } = require("../../helpers/documents");
const { invoiceUrl } = require("../../helpers/notifications/panelLinks");
const {
  notifySubscriptionActivated,
} = require("../../helpers/notifications");

/**
 * Admin grants a subscription with no online payment.
 *
 * Covers the two real-world cases the paid flow cannot: a complimentary plan,
 * and money already collected offline (cash, bank transfer, cheque). Either way
 * a Transaction row is still written — with `gateway: MANUAL` and no Razorpay
 * order — so admin grants show up in the same reporting and audit trail as card
 * payments, and still get an invoice.
 *
 * Unlike the vendor-facing flow, a downgrade here is allowed to leave the brand
 * over its new limits: existing outlets are grandfathered rather than deleted,
 * and the overflow comes back in the response so the panel can warn the admin.
 */
exports.adminGrantSubscription = async (actor, payload) => {
  const {
    brandId,
    subscriptionId,
    startDate: requestedStart,
    durationInDays: overrideDays,
    paymentMode = MANUAL_PAYMENT_MODES.FREE,
    collectedAmount,
    referenceNumber,
    keepCurrentEndDate = false,
    note,
  } = payload;

  const config = await getSubscriptionConfig();
  if (!config.allowAdminFreeGrant) {
    throwError(
      403,
      "Manual subscription grants are disabled in the current platform settings.",
    );
  }

  const brand = await Brand.findById(brandId);
  if (!brand || brand.isDeleted) throwError(404, "Brand not found!");

  const subscription = await Subscription.findById(subscriptionId).lean();
  if (!subscription || subscription.isDeleted) {
    throwError(404, "Subscription plan not found!");
  }
  // An inactive plan is still grantable by an admin on purpose — that is how a
  // retired or bespoke plan gets honoured for a specific brand.

  const durationInDays = overrideDays ?? subscription.durationInDays;
  if (!durationInDays && !subscription.durationInYears) {
    throwError(
      422,
      `Plan "${subscription.name}" has no duration configured. Pass durationInDays to grant it.`,
    );
  }

  const active = await getActiveSubscription(brand._id);
  const currentPlan = active?.subscriptionId
    ? await Subscription.findById(active.subscriptionId).lean()
    : null;
  const { action } = resolveSubscriptionAction(
    active,
    currentPlan,
    subscription,
  );

  if (
    action === SUBSCRIPTION_ACTION.DOWNGRADE &&
    !config.allowAdminDowngrade
  ) {
    throwError(
      403,
      "Downgrades are disabled in the current platform settings.",
    );
  }

  const startDate = requestedStart ? new Date(requestedStart) : new Date();

  // `keepCurrentEndDate` is the "fix the tier, don't touch the validity" case —
  // correcting a mis-sold plan without silently extending or shortening what
  // the vendor already paid for. It needs an existing plan to inherit from.
  if (keepCurrentEndDate && !active) {
    throwError(
      422,
      "keepCurrentEndDate requires an active subscription to inherit the end date from.",
    );
  }

  const validity = {
    startDate,
    endDate: keepCurrentEndDate
      ? new Date(active.endDate)
      : calculateEndDate(
          startDate,
          overrideDays ? null : subscription.durationInYears,
          durationInDays,
        ),
  };
  if (validity.endDate <= new Date()) {
    throwError(
      422,
      "The computed end date is already in the past. Check startDate and durationInDays.",
    );
  }

  // Price the grant exactly as if it were sold, so the GST breakdown is on
  // record even when nothing was charged. FREE grants record the full tax
  // position with a zero collection against it.
  const billing = await buildBillingDetails(brand);
  const pricing = calculatePricing({
    subscription,
    config,
    buyer: { gstin: billing.gstin, state: billing.state },
  });

  const isFree = paymentMode === MANUAL_PAYMENT_MODES.FREE;
  const paidAmount = isFree ? 0 : (collectedAmount ?? pricing.totalPayable);
  if (paidAmount > pricing.totalPayable) {
    throwError(
      422,
      `Collected amount (₹${paidAmount}) cannot exceed the plan total (₹${pricing.totalPayable}).`,
    );
  }

  /**
   * A grant draws from its **own** series.
   *
   * `TD/GRT/26-27/000001`, not `TD/SUB/...`. A grant and a sale are different
   * events — one collected money through the gateway and one did not — and mixing
   * them into a single sequence makes the subscription series unreadable as a
   * record of what was actually sold. The document says so on its face too; this
   * makes the number say it as well.
   */
  const invoiceId = await generateDocumentNumber({
    series: DOCUMENT_SERIES[DOCUMENT_KIND.SUBSCRIPTION_GRANT],
  });

  const transaction = await Transaction.create({
    // A manual grant never touches Razorpay, but it is still a subscription
    // transaction and must sit in the same ledger, under the same purpose, as
    // a paid one. `gatewayAccount` records which side of the business it
    // belongs to — nothing will ever verify a signature against it.
    purpose: TRANSACTION_PURPOSE.SUBSCRIPTION,
    gatewayAccount: ACCOUNT_FOR_PURPOSE[TRANSACTION_PURPOSE.SUBSCRIPTION],
    brandId: brand._id,
    subscriptionId: subscription._id,
    userId: brand.userId,
    createdBy: actor.userId,
    email: brand.email,
    contact: brand.whatsappNumber || brand.mobile,
    gateway: PAYMENT_GATEWAYS.MANUAL,
    manualPaymentMode: paymentMode,
    // A synthetic reference rather than null. The unique index on this field is
    // now partial on `$type: "string"`, so a null would in fact be allowed —
    // but a MANUAL row with a traceable reference is easier to reconcile than a
    // blank one, and the value is already printed on the audit trail.
    razorpayOrderId: `MANUAL-${invoiceId}`,
    referenceNumber,
    note,
    amount: pricing.totalPayable,
    pricing,
    currency: pricing.currency,
    status: PAYMENT_STATUS.CAPTURED,
    verified: true,
    verifiedAt: new Date(),
    paidAmount,
    dueAmount: Math.max(0, pricing.totalPayable - paidAmount),
    invoiceId,
    // The vendor's download link. A grant is captured the moment it is created,
    // so unlike a paid order there is nothing to wait for — the token can be
    // minted here.
    documentToken: crypto.randomBytes(32).toString("hex"),
  });

  const { subscribed, sync, notice } = await activateSubscription({
    brand,
    subscription,
    actor,
    action,
    source: SUBSCRIPTION_SOURCE.ADMIN_MANUAL,
    pricing,
    validity,
    transaction,
    paymentMode,
    referenceNumber,
    adminNote: note,
    paidAmount,
    dueAmount: Math.max(0, pricing.totalPayable - paidAmount),
    isFreeGrant: isFree,
  });

  try {
    /**
     * Same snapshot path as the paid flow, so a grant's document is shaped
     * identically and is equally reproducible — and, like the paid flow, only the
     * snapshot is written here. The PDF renders on the first download.
     *
     * `isManual` is what makes the document say what it is: a GRANT ADVICE rather
     * than a receipt, naming the payment mode, the reference and the admin's note,
     * and stating plainly that nothing was collected through the gateway.
     */
    const invoiceSnapshot = buildInvoiceSnapshot({
      transaction,
      subscription,
      pricing,
      config,
      billing,
      validity,
      isManual: true,
      paymentMethod: paymentMode,
      documentNumber: invoiceId,
    });
    await Transaction.updateOne(
      { _id: transaction._id },
      { $set: { invoiceSnapshot } },
    );
  } catch (error) {
    // The grant is already live; a missing document must not undo it.
    console.error(
      `[adminGrantSubscription] invoice failed for transaction ${transaction._id}:`,
      error?.message,
    );
  }

  /**
   * Re-read, for the snapshot the block above wrote.
   *
   * Falls back to the in-memory document rather than being trusted to exist: the
   * grant is already live at this point, and a null here would turn a successful
   * grant into a 500 on `.toObject()`.
   */
  const granted = (await Transaction.findById(transaction._id)) || transaction;

  // After the document stage, so the vendor's email carries the grant reference
  // and the Download Advice button. See the note in `activateSubscription`.
  await notifySubscriptionActivated({ ...notice, transaction: granted });

  return {
    subscribed,
    transaction: granted.toObject(),
    invoiceId,
    invoiceDownloadUrl: invoiceUrl(granted.documentToken),
    action,
    pricing,
    orderSummary: buildOrderSummary(pricing, config),
    limits: summarizeUsage(
      await Brand.findById(brand._id).lean(),
      sync.entitlements,
    ),
    // Non-zero after a grandfathered downgrade: existing entries keep working,
    // nothing new can be added until usage drops back under the limit.
    overflow: sync.overflow,
    entitlementsSource: sync.source,
  };
};
