const Transaction = require("../../models/Transaction");
const { throwError } = require("../../utils");
const {
  generateAndUploadInvoice,
  buildTransactionFilter,
} = require("../../helpers/transactions");

/**
 * Resolve a public invoice link to a downloadable URL.
 *
 * ### Why a token and not the transaction id
 *
 * The link goes into a WhatsApp message and an email, where it will be forwarded,
 * screenshotted and pasted into support chats. An id is guessable and sequential
 * neighbours are other people's invoices; a 32-byte random token is neither, and
 * revoking one is a single field update rather than a schema change.
 *
 * It is deliberately **unauthenticated**. A customer opening their invoice from
 * a WhatsApp message has no session in that browser, and requiring a login there
 * means the Download button does not work — which is the one thing it has to do.
 * The token is the credential.
 *
 * ### The PDF is rendered here, not at settle time
 *
 * Rendering and uploading a PDF on every claim does not survive scale, and most
 * invoices are never opened. The **number** is allotted at settle time so the
 * series has no gaps; the document itself is built the first time somebody asks
 * for it, and cached on the transaction after that.
 *
 * @param {string} token
 * @returns {Promise<{ url: string, invoiceId: string }>}
 */
exports.getInvoiceByToken = async (token) => {
  if (!token) throwError(404, "Invoice not found.");

  // `purpose: null` deliberately: this link serves both subscription and claim
  // invoices, and the token is unique across the whole collection.
  const transaction = await Transaction.findOne({
    ...buildTransactionFilter({ purpose: null }),
    invoiceToken: token,
  });

  // Deliberately the same answer as a token that does not exist. Telling the
  // holder of a bad token that it *almost* worked is how a guessing attempt
  // learns it is close.
  if (!transaction) throwError(404, "Invoice not found.");

  if (!transaction.invoiceSnapshot) {
    // A settled transaction always has one. Its absence means the settle never
    // reached the invoice stage — the resume job's problem, not something to
    // paper over by generating a document from live data that may have moved.
    throwError(
      409,
      "This invoice is not ready yet. Please try again in a few minutes.",
    );
  }

  if (transaction.invoiceUrl) {
    return { url: transaction.invoiceUrl, invoiceId: transaction.invoiceId };
  }

  // First request for this invoice: render it, upload it, remember it.
  const invoiceUrl = await generateAndUploadInvoice(transaction.invoiceSnapshot);
  if (!invoiceUrl) {
    throwError(503, "Could not prepare the invoice. Please try again.");
  }

  await Transaction.updateOne(
    { _id: transaction._id },
    { $set: { invoiceUrl } },
  );

  return { url: invoiceUrl, invoiceId: transaction.invoiceId };
};
