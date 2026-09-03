/**
 * MongoDB error codes this codebase branches on.
 *
 * There is exactly one that matters here, and it matters a great deal.
 */

/**
 * Duplicate key — **used as a signal, not as an error.**
 *
 * Seven places rely on losing this race rather than winning it:
 *
 * | Where | What 11000 means there |
 * |---|---|
 * | `createVoucherClaimOrder` | another tap already opened this order — reuse it |
 * | `requestRefund` | a refund is already open on this payment — hand it back |
 * | `acquireJobLock` | another instance is running this job — stand down |
 * | `recordLedgerEntry` | this entry is already booked — do not book it twice |
 * | `generateInvoiceNumber` | the number was taken between read and write — retry |
 * | `generateClaimCode` | code collision — retry with a new one |
 * | `notify` / `notifyAudience` | this notification was already sent |
 *
 * That is the whole point of the partial-unique indexes across this codebase:
 * **the index decides who wins, not the timing of a read-then-write check.** Two
 * concurrent callers both pass "is one already open?"; only one survives the
 * insert.
 *
 * Which is also why catching this must never be widened into a general
 * try/catch. A duplicate key is an expected outcome; anything else reaching that
 * branch is a real failure being swallowed.
 */
const DUPLICATE_KEY = 11000;

/**
 * An index whose options conflict with one already on the collection.
 *
 * Raised when a same-key-pattern index is created under a different name — and
 * Mongoose swallows it during `autoIndex`, so the index simply never appears and
 * nothing says why. `assertMoneyIndexes` exists because of this.
 */
const INDEX_OPTIONS_CONFLICT = 85;

module.exports = Object.freeze({
  DUPLICATE_KEY,
  INDEX_OPTIONS_CONFLICT,
});
