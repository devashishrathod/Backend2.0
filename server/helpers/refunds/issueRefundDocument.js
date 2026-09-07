const crypto = require("crypto");
const RefundRequest = require("../../models/RefundRequest");
const Transaction = require("../../models/Transaction");
const { getSubscriptionConfig } = require("../settings");
const { generateDocumentNumber, alertDocumentFailed } = require("../documents");
const { ADMIN_PATHS } = require("../notifications");
const { DOCUMENT_KIND, DOCUMENT_SERIES } = require("../../constants/document");
const {
  buildRefundDocumentSnapshot,
} = require("./buildRefundDocumentSnapshot");

/**
 * Issue the customer's refund document.
 *
 * ### ⚠️ Called only from `applyRefundCompletion`
 *
 * The number is allotted when the money has **actually reached the customer** —
 * the `refund.processed` webhook — and nowhere earlier. Approval is not the
 * moment: a refund can be approved, initiated, and then fail at the gateway.
 * Numbering at approval would burn a number out of a document-of-record series on
 * every failure, and hand the customer a receipt for money they never got.
 *
 * The cost is that the customer has no paper for the one to three days a refund
 * takes to land. They are not left in silence — approval already sends its own
 * notification, and this document arrives with the "money has left" one.
 *
 * ### Idempotent, because the webhook is not delivered once
 *
 * Razorpay redelivers, and `applyRefundCompletion` also runs a repair path for a
 * completion that lost its ledger rows. Both can reach here. The
 * `$exists: false` guard means the second caller allots nothing — a second number
 * would leave a hole in the series, which is the exact thing this ordering
 * protects.
 *
 * ### Never throws
 *
 * The money has already moved. A document that could not be built is a re-issue
 * problem; it must not fail the completion, roll back the ledger, or make a
 * redelivered webhook look unprocessed. The caller gets `null` and carries on.
 *
 * @param {object} args
 * @param {object} args.refundRequest  the request, already COMPLETED
 * @param {object} args.claim
 * @param {object} args.transaction    the original payment
 * @param {string} [args.utr]
 * @returns {Promise<object|null>} the refreshed request, or null if nothing was issued
 */
exports.issueRefundDocument = async ({
  refundRequest,
  claim,
  transaction,
  utr,
}) => {
  if (!refundRequest?._id) return null;
  // Already issued — a redelivery, or the ledger-repair path running again.
  if (refundRequest.documentNumber) return null;

  try {
    const seller = await getSubscriptionConfig();

    /**
     * The original payment, for the number this document reverses and the tax
     * character it inherits. Re-read rather than trusted from the caller, because
     * `applyRefundCompletion` may hand over a `lean()` copy taken before the
     * settle wrote the snapshot.
     */
    const original =
      transaction?.invoiceSnapshot
        ? transaction
        : await Transaction.findById(refundRequest.transactionId).lean();

    /**
     * ⚠️ Allotted **after** every lookup, and as late as it can be.
     *
     * `generateDocumentNumber` advances a shared counter, so anything that
     * throws between taking a number and writing it leaves that number attached
     * to nothing — a hole in a document-of-record series, which is the one thing
     * this series may not have.
     *
     * This used to sit above the config read and the transaction read, so a slow
     * or missing row burned a number on the way past. Only the snapshot build
     * and the write are after it now, and the snapshot needs the number.
     */
    const documentNumber = await generateDocumentNumber({
      series: DOCUMENT_SERIES[DOCUMENT_KIND.REFUND],
    });

    const documentSnapshot = buildRefundDocumentSnapshot({
      refundRequest,
      claim,
      transaction: original || {},
      seller,
      documentNumber,
      utr,
    });

    // Conditional on the number still being absent, so two racing webhooks
    // cannot both allot one.
    return await RefundRequest.findOneAndUpdate(
      { _id: refundRequest._id, documentNumber: { $exists: false } },
      {
        $set: {
          documentNumber,
          documentSnapshot,
          documentToken: crypto.randomBytes(32).toString("hex"),
        },
      },
      { returnDocument: "after" },
    ).lean();
  } catch (error) {
    /**
     * The refund is complete and the customer has their money, so this must not
     * throw — but it must not be silent either.
     *
     * It was a bare `console.error`, which meant a customer holding a refund
     * with no receipt was a fact nobody learned until they asked for it. There
     * is no re-issue endpoint for a refund document, so nothing else was ever
     * going to surface it.
     */
    await alertDocumentFailed({
      source: "issueRefundDocument",
      title: "A refund receipt could not be issued",
      body:
        `The refund completed and the customer has their money, but the receipt ` +
        `could not be written. They have no document for a refund that reverses a ` +
        `tax invoice, and there is no self-service way to produce one.`,
      recordId: refundRequest._id,
      path: ADMIN_PATHS.refund(refundRequest._id),
      lines: [
        ["Refund request", String(refundRequest._id)],
        ["Amount", String(refundRequest.refundAmount ?? "-")],
        ["Claim", String(refundRequest.voucherClaimId ?? claim?._id ?? "-")],
      ],
      footnote:
        "The money has moved and the ledger is correct — only the document is missing. Re-issuing it is a manual step.",
      error,
    });
    return null;
  }
};
