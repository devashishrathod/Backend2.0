const { notifyAdmins, adminUrl, deepLink } = require("../notifications");
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_SEVERITY,
} = require("../../constants/notification");

/**
 * Tell somebody a document could not be issued.
 *
 * ### Why this exists
 *
 * Every document issuer here is deliberately unable to throw: the money has
 * already moved, and failing a completed refund or a finished payout to report a
 * missing PDF would be far worse than the missing PDF. That part is right.
 *
 * What was wrong is that "must not fail" had been implemented as "must not be
 * mentioned". `issueRefundDocument`, `issueSettlementDocument` and
 * `issueChargebackDocument` each ended in a bare `console.error`, so a customer
 * with their money and no receipt — or a vendor with a payout and no statement —
 * was a fact nobody learned until they asked. The paid-subscription path already
 * raised an alert here; these did not.
 *
 * It matters more than a missing receipt suggests. Two of these carry
 * GST-facing numbers: a refund receipt reverses a tax invoice, and a settlement
 * statement can carry the commission invoice for a taxable supply. And unlike a
 * transaction document there is **no re-issue endpoint** for any of them —
 * `POST /transactions/invoice/regenerate` covers Transaction-backed documents
 * only, so recovery here starts with somebody knowing.
 *
 * ### It never throws
 *
 * `notifyAdmins` goes through `notifyAudience`, which swallows delivery failures
 * but deliberately propagates an invalid or oversized audience so a caller's
 * mistake is not hidden. Here that guarantee points the wrong way: this runs
 * after the money moved, inside a `catch` that exists precisely so nothing
 * escapes. So the call is wrapped, and a lost alert is logged rather than
 * raised.
 *
 * @param {object} args
 * @param {string} args.source     the calling helper, for the log line
 * @param {string} args.title      what could not be issued, in plain words
 * @param {string} args.body       what it means for the person on the other end
 * @param {string} args.recordId   the row to open, and the dedupe key
 * @param {string} args.path       an ADMIN_PATHS value for that row
 * @param {Array}  args.lines      label/value pairs for the mail table
 * @param {string} args.footnote   what is and is not broken
 * @param {Error}  [args.error]    the original failure
 */
exports.alertDocumentFailed = async ({
  source,
  title,
  body,
  recordId,
  path,
  lines = [],
  footnote,
  error,
}) => {
  console.error(`[${source}] ${title} (${recordId}):`, error?.message);

  try {
    await notifyAdmins({
      type: NOTIFICATION_TYPES.WEBHOOK_FAILED,
      severity: NOTIFICATION_SEVERITY.WARNING,
      title,
      body,
      meta: { recordId: String(recordId), reason: error?.message },
      // One alert per record, so a redelivering webhook or a repeating job does
      // not become a mail storm about the same missing document.
      dedupeKey: `DOCUMENT_FAILED:${source}:${recordId}`,
      deepLink: deepLink(path),
      mail: {
        lines: [...lines, ["Reason", error?.message || "-"]],
        ctaLabel: "Open record",
        ctaUrl: adminUrl(path),
        footnote,
      },
    });
  } catch (alertError) {
    console.error(
      `[${source}] could not raise the document-failure alert for ${recordId}:`,
      alertError?.message,
    );
  }
};
