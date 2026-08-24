const Brand = require("../../models/Brand");
const Subscription = require("../../models/Subscription");
const Transaction = require("../../models/Transaction");
const Subscribed = require("../../models/Subscribed");
const { ROLES } = require("../../constants");
const { PAYMENT_GATEWAYS } = require("../../constants/subscription");
const { throwError } = require("../../utils");
const { getSubscriptionConfig } = require("../../helpers/settings");
const { buildBillingDetails } = require("../../helpers/subscribeds");
const {
  generateAndUploadInvoice,
  buildInvoiceSnapshot,
} = require("../../helpers/transactions");

/**
 * Build a snapshot for a transaction issued before snapshots existed.
 *
 * Reconstructed from whatever is still available, then **stored**, so the
 * transaction becomes reproducible from that point on: the first re-issue of a
 * legacy invoice may differ from the original (the seller identity or brand
 * address may have moved on since), but every re-issue after it is identical.
 *
 * Validity dates come from the Subscribed record this transaction activated —
 * the only place they were ever kept. That is what used to make the plan end date
 * print as "-": the generator had no way to reach them.
 */
const backfillSnapshot = async (transaction) => {
  const [subscription, brand, subscribed, config] = await Promise.all([
    Subscription.findById(transaction.subscriptionId).lean(),
    Brand.findById(transaction.brandId),
    transaction.subscribedId
      ? Subscribed.findById(transaction.subscribedId).lean()
      : Subscribed.findOne({ transactionId: transaction._id }).lean(),
    getSubscriptionConfig(),
  ]);

  if (!brand) throwError(404, "Brand not found!");

  const billing = await buildBillingDetails(brand);

  return buildInvoiceSnapshot({
    transaction,
    subscription,
    pricing: transaction.pricing,
    config,
    billing,
    validity: {
      startDate: subscribed?.startDate || transaction.verifiedAt || transaction.createdAt,
      endDate: subscribed?.endDate,
    },
    isManual: transaction.gateway === PAYMENT_GATEWAYS.MANUAL,
    paymentMethod: transaction.paymentMethod || transaction.manualPaymentMode,
  });
};

/**
 * Re-issue the PDF invoice for a transaction.
 *
 * Needed for three situations that previously had no answer, because
 * `invoiceUrl` was written once at verification and never again:
 *  - PDF generation failed at the time, so the vendor has a paid subscription
 *    and no invoice;
 *  - the seller identity was wrong or missing when it was issued;
 *  - the vendor simply lost the file.
 *
 * Renders from the **frozen `invoiceSnapshot`**, so the re-issued document is
 * identical to the original — same amounts, same plan name, same addresses, same
 * validity dates — regardless of what has changed since. Nothing is recomputed.
 *
 * Vendors may re-issue their own; admins any.
 */
exports.regenerateInvoice = async (actor, payload) => {
  const { transactionId } = payload;

  const transaction = await Transaction.findById(transactionId);
  if (!transaction || transaction.isDeleted) {
    throwError(404, "Transaction not found!");
  }

  const isAdmin = actor.role === ROLES.ADMIN;
  if (!isAdmin) {
    const brand = await Brand.findById(transaction.brandId)
      .select("userId")
      .lean();
    if (!brand || String(brand.userId) !== String(actor.userId)) {
      throwError(
        403,
        "Forbidden: You do not have permission to access this invoice.",
      );
    }
  }

  // An unpaid order has nothing to invoice. Manual admin grants are captured on
  // creation, so they pass this check.
  if (!transaction.verified) {
    throwError(
      422,
      "This transaction has no completed payment, so there is no invoice to issue.",
    );
  }

  let snapshot = transaction.invoiceSnapshot;
  let wasBackfilled = false;

  if (!snapshot?.invoiceId) {
    if (!transaction.pricing?.amountInPaise && transaction.pricing?.totalPayable == null) {
      throwError(
        422,
        "This transaction has no stored pricing breakdown, so its invoice cannot be rebuilt.",
      );
    }
    snapshot = await backfillSnapshot(transaction);
    await Transaction.updateOne(
      { _id: transaction._id },
      { $set: { invoiceSnapshot: snapshot } },
    );
    wasBackfilled = true;
  }

  const previousUrl = transaction.invoiceUrl || null;

  // Deliberately not wrapped: a re-issue that cannot produce a PDF should fail
  // loudly, unlike the fire-and-forget generation during checkout.
  const invoiceUrl = await generateAndUploadInvoice(
    // A mongoose subdocument works, but plain data keeps the generator honest
    // about reading nothing it was not given.
    typeof snapshot.toObject === "function" ? snapshot.toObject() : snapshot,
  );

  await Transaction.updateOne(
    { _id: transaction._id },
    { $set: { invoiceUrl } },
  );

  return {
    transactionId: transaction._id,
    invoiceId: snapshot.invoiceId,
    invoiceUrl,
    previousUrl,
    // True the first time a pre-snapshot transaction is re-issued. Its snapshot
    // is now stored, so every later re-issue is byte-identical to this one.
    snapshotBackfilled: wasBackfilled,
    snapshot: {
      planName: snapshot.planName,
      planStart: snapshot.planStart,
      planEnd: snapshot.planEnd,
      seller: { name: snapshot.seller?.name, gstin: snapshot.seller?.gstin || null },
      billTo: {
        name: snapshot.billTo?.name,
        gstin: snapshot.billTo?.gstin || null,
        address: snapshot.billTo?.address || null,
      },
      pricing: snapshot.pricing,
    },
  };
};
