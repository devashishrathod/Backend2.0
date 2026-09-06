const crypto = require("crypto");
const Brand = require("../../models/Brand");
const Subscription = require("../../models/Subscription");
const Transaction = require("../../models/Transaction");
const Subscribed = require("../../models/Subscribed");
const { ROLES } = require("../../constants");
const { PAYMENT_GATEWAYS } = require("../../constants/subscription");
const { DOCUMENT_KIND, DOCUMENT_SERIES } = require("../../constants/document");
const { throwError } = require("../../utils");
const { getSubscriptionConfig } = require("../../helpers/settings");
const { buildBillingDetails } = require("../../helpers/subscribeds");
const { buildInvoiceSnapshot } = require("../../helpers/transactions");
const {
  generateAndUploadDocument,
  generateDocumentNumber,
} = require("../../helpers/documents");
const { invoiceUrl } = require("../../helpers/notifications/panelLinks");

/**
 * Build a snapshot for a transaction that has none.
 *
 * Two cases reach this, and they are not the same:
 *
 *  - a transaction settled before snapshots existed, and
 *  - a settlement whose **document stage failed** — the payment captured, the
 *    plan went live, and the invoice number and snapshot were never written.
 *
 * The second one is why this also allots a number. `settleSubscriptionPayment`
 * raises an admin alert saying "the vendor has a paid subscription with no
 * invoice — re-issue it from the transaction", and that instruction has to
 * actually work. Before, a transaction with no number could only be re-issued
 * into a document with a blank invoice number on it.
 *
 * Reconstructed from whatever is still available, then **stored**, so the
 * transaction becomes reproducible from that point on: this first re-issue may
 * differ from what the original would have been (the seller identity or brand
 * address may have moved on), but every re-issue after it is identical.
 *
 * Validity dates come from the `Subscribed` record this transaction activated —
 * the only place they were ever kept. That is what used to make the plan end date
 * print as `-`: the renderer had no way to reach them.
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
  const isManual = transaction.gateway === PAYMENT_GATEWAYS.MANUAL;

  /**
   * A number, if this transaction never got one.
   *
   * Drawn from the series that matches what actually happened — a grant from the
   * grant series, a sale from the subscription series — so a recovered document
   * does not land in the wrong sequence.
   */
  const documentNumber =
    transaction.invoiceId ||
    (await generateDocumentNumber({
      series: isManual
        ? DOCUMENT_SERIES[DOCUMENT_KIND.SUBSCRIPTION_GRANT]
        : DOCUMENT_SERIES[DOCUMENT_KIND.SUBSCRIPTION],
    }));

  const snapshot = buildInvoiceSnapshot({
    transaction,
    subscription,
    pricing: transaction.pricing,
    config,
    billing,
    validity: {
      startDate:
        subscribed?.startDate || transaction.verifiedAt || transaction.createdAt,
      endDate: subscribed?.endDate,
    },
    isManual,
    paymentMethod: transaction.paymentMethod || transaction.manualPaymentMode,
    documentNumber,
  });

  return { snapshot, documentNumber };
};

/**
 * Re-issue the document for a transaction.
 *
 * Needed for four situations that previously had no answer, because `invoiceUrl`
 * was written once at verification and never again:
 *  - the document stage failed at settle, so the vendor has a paid subscription
 *    and no invoice at all;
 *  - PDF generation failed at the time;
 *  - the seller identity was wrong or missing when it was issued;
 *  - the vendor simply lost the file.
 *
 * Renders from the **frozen snapshot**, so a re-issued document is identical to
 * the original — same amounts, same plan name, same addresses, same validity
 * dates — regardless of what has changed since. Nothing is recomputed.
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

  if (!snapshot?.documentNumber) {
    if (
      !transaction.pricing?.amountInPaise &&
      transaction.pricing?.totalPayable == null
    ) {
      throwError(
        422,
        "This transaction has no stored pricing breakdown, so its invoice cannot be rebuilt.",
      );
    }

    const built = await backfillSnapshot(transaction);
    snapshot = built.snapshot;

    await Transaction.updateOne(
      { _id: transaction._id },
      {
        $set: {
          invoiceSnapshot: snapshot,
          invoiceId: built.documentNumber,
          // A recovered transaction may never have been given a download link
          // either. Minted only if it is missing, so an existing link keeps
          // working for anybody who already has it.
          ...(transaction.documentToken
            ? {}
            : { documentToken: crypto.randomBytes(32).toString("hex") }),
        },
      },
    );
    wasBackfilled = true;
  }

  const previousUrl = transaction.invoiceUrl || null;

  // Deliberately not wrapped: a re-issue that cannot produce a PDF should fail
  // loudly, unlike the fire-and-forget generation during checkout.
  const generatedUrl = await generateAndUploadDocument(
    // A mongoose subdocument works, but plain data keeps the renderer honest
    // about reading nothing it was not given.
    typeof snapshot.toObject === "function" ? snapshot.toObject() : snapshot,
  );

  await Transaction.updateOne(
    { _id: transaction._id },
    { $set: { invoiceUrl: generatedUrl } },
  );

  const reissued = await Transaction.findById(transaction._id)
    .select("documentToken invoiceId")
    .lean();

  return {
    transactionId: transaction._id,
    invoiceId: reissued?.invoiceId || snapshot.documentNumber,
    invoiceUrl: generatedUrl,
    // The link to hand the vendor. The raw storage URL above cannot be revoked;
    // this one resolves through the token and can be.
    invoiceDownloadUrl: invoiceUrl(reissued?.documentToken),
    previousUrl,
    // True the first time a transaction with no snapshot is re-issued. Its
    // snapshot is now stored, so every later re-issue is identical to this one.
    snapshotBackfilled: wasBackfilled,
    snapshot: {
      kind: snapshot.kind,
      title: snapshot.title,
      documentNumber: snapshot.documentNumber,
      issuedAt: snapshot.issuedAt,
      seller: {
        name: snapshot.seller?.name,
        gstin: snapshot.seller?.gstin || null,
      },
      billTo: {
        name: snapshot.billTo?.name,
        gstin: snapshot.billTo?.gstin || null,
        address: snapshot.billTo?.address || null,
      },
      details: snapshot.details,
      timeline: snapshot.timeline,
      pricing: snapshot.pricing,
    },
  };
};
