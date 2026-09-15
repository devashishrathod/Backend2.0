const Transaction = require("../../models/Transaction");
const { toMediaDocument } = require("../../helpers/media");
const { MEDIA_KIND } = require("../../constants/storage");
const RefundRequest = require("../../models/RefundRequest");
const Dispute = require("../../models/Dispute");
const Settlement = require("../../models/Settlement");
const { throwError } = require("../../utils");
const storage = require("../storage");
const { generateAndUploadDocument } = require("../../helpers/documents");
const { buildTransactionFilter } = require("../../helpers/transactions");

/**
 * Where a document token can live, and how to read one out of each collection.
 *
 * ### Why a table rather than four endpoints
 *
 * There used to be two public routes — `/transactions/invoice/:token` and
 * `/settlements/statement/:token` — each with its own token field name. A refund
 * and a chargeback advice would have needed a third and a fourth, and the field
 * names would have kept diverging. But a token in a WhatsApp message carries no
 * hint of which kind of document it is, so a link could only ever be built by
 * code that already knew — which is why nothing could hand a customer "their
 * documents" as one list.
 *
 * One field name (`documentToken`), one route, one resolver. A seventh document
 * kind is a row here.
 *
 * Each entry names the collection, the snapshot it carries and the two fields the
 * rendered PDF is cached into. `filter` exists because `Transaction` must go
 * through `buildTransactionFilter` — a soft-deleted or purpose-scoped row must
 * not be reachable just because somebody holds a token for it.
 */
const SOURCES = [
  {
    model: Transaction,
    // `purpose: null` deliberately: this serves subscription invoices, grant
    // advices and claim receipts alike, and the token is unique collection-wide.
    filter: () => buildTransactionFilter({ purpose: null }),
    snapshot: "invoiceSnapshot",
    numberField: "invoiceId",
    urlField: "invoiceUrl",
  },
  {
    model: RefundRequest,
    filter: () => ({ isDeleted: false }),
    snapshot: "documentSnapshot",
    numberField: "documentNumber",
    urlField: "documentUrl",
  },
  {
    model: Dispute,
    filter: () => ({ isDeleted: false }),
    snapshot: "documentSnapshot",
    numberField: "documentNumber",
    urlField: "documentUrl",
  },
  {
    model: Settlement,
    filter: () => ({ isDeleted: false }),
    snapshot: "documentSnapshot",
    numberField: "settlementNumber",
    urlField: "documentUrl",
  },
];

/**
 * Resolve a public document link to a downloadable URL.
 *
 * ### Why a token and not the record id
 *
 * The link goes into a WhatsApp message and an email, where it will be forwarded,
 * screenshotted and pasted into support chats. An id is guessable and its
 * sequential neighbours are other people's documents; a 32-byte random token is
 * neither, and revoking one is a single field update rather than a schema change.
 *
 * It is deliberately **unauthenticated**. A customer opening their receipt from a
 * WhatsApp message has no session in that browser, and requiring a login there
 * means the Download button does not work — which is the one thing it has to do.
 * The token is the credential.
 *
 * ### The PDF is rendered here, not when the document is issued
 *
 * Rendering and uploading a PDF for every claim, payout and refund does not
 * survive scale, and most are never opened. The **number** is allotted when the
 * document is issued so the series has no gaps; the file itself is built the
 * first time somebody asks for it, and cached on the record after that.
 *
 * @param {string} token
 * @returns {Promise<{ url: string, documentNumber: string, kind: string }>}
 */
exports.getDocumentByToken = async (token) => {
  if (!token) throwError(404, "Document not found.");

  let found = null;
  for (const source of SOURCES) {
    const record = await source.model.findOne({
      ...source.filter(),
      documentToken: token,
    });
    if (record) {
      found = { record, source };
      break;
    }
  }

  // Deliberately the same answer as a token that does not exist. Telling the
  // holder of a bad token that it *almost* worked is how a guessing attempt
  // learns it is close.
  if (!found) throwError(404, "Document not found.");

  const { record, source } = found;
  const snapshot = record[source.snapshot];

  if (!snapshot?.documentNumber) {
    /**
     * A record that reached the document stage always has one. Its absence means
     * the issuing step never ran or failed — the resume job's and the re-issue
     * endpoint's problem, not something to paper over by building a document from
     * live data that may have moved since.
     */
    throwError(
      409,
      "This document is not ready yet. Please try again in a few minutes.",
    );
  }

  const answer = (url) => ({
    url,
    documentNumber: snapshot.documentNumber,
    kind: snapshot.kind,
  });

  /**
   * ---------------- the file is already there ----------------
   *
   * 🔴 A **fresh** link every time, not a stored one.
   *
   * The URL used to be cached on the record and handed back for ever. On a
   * private bucket there is no lasting URL to cache: one is minted per request
   * and dies in minutes. That is the whole point — `documentToken` can be
   * revoked, and now the link behind it goes stale on its own too, so a
   * forwarded WhatsApp message stops being a permanent key to somebody's name,
   * address, GSTIN and amount.
   */
  if (record.documentMedia?.storage) {
    /**
     * ⚠️ The media value **is** `{ url, storage }` — the shape `documentUrl`
     * takes — so it goes straight through. The URL beside it is still passed
     * for the Cloudinary case, where the delivery link is the only one there is.
     */
    return answer(
      await storage.documentUrl({
        storage: record.documentMedia.storage,
        url: record.documentMedia.url || record[source.urlField],
      }),
    );
  }

  /**
   * ⚠️ Rows written before `documentMedia` existed have only the URL, and
   * they must keep working. Nothing is migrated: the file is where it is, and
   * that link is the only way back to it.
   */
  const cached = record[source.urlField];
  if (cached) return answer(cached);

  // First request for this document: render it, upload it, remember where.
  const uploaded = await generateAndUploadDocument(
    // A mongoose subdocument works, but plain data keeps the renderer honest
    // about reading nothing it was not given.
    typeof snapshot.toObject === "function" ? snapshot.toObject() : snapshot,
  );
  if (!uploaded?.storage) {
    throwError(503, "Could not prepare the document. Please try again.");
  }

  /**
   * ⚠️ `url` is stored **as well**, and only because Cloudinary has nothing
   * else: its delivery URL is the only link there is. On S3 it is null, and
   * the branch above never reads it.
   */
  await source.model.updateOne(
    { _id: record._id },
    {
      $set: {
        documentMedia: toMediaDocument(uploaded, { kind: MEDIA_KIND.DOCUMENT }),
        ...(uploaded.url ? { [source.urlField]: uploaded.url } : {}),
      },
    },
  );

  return answer(
    await storage.documentUrl({
      storage: uploaded.storage,
      url: uploaded.url,
    }),
  );
};

