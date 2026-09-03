const VoucherClaimHistory = require("../../models/VoucherClaimHistory");
const { ROLES } = require("../../constants");
const {
  CLAIM_TIMELINE_LABEL,
  CLAIM_TIMELINE_INTERNAL_ACTIONS,
} = require("../../constants/voucherClaim");

/**
 * The claim's story, told to whoever is reading it.
 *
 * `VoucherClaimHistory` is append-only and deliberately complete — it records
 * whatever mattered at the time, for forensics. That completeness is exactly why
 * it cannot be handed to a page as-is:
 *
 *  - **`snapshot` is `Mixed`.** Today it carries the whole pricing block on a
 *    `CLAIM_CREATED` row, `platformPromoCost` included. Rendering it raw on a
 *    vendor's timeline hands them our margin through the back door, past the
 *    projection built to hide it — and it would keep doing so for every field
 *    any future call site decides to stash in there.
 *  - **`reason` is free text written by staff for staff.** "Refunded, customer
 *    disputes the bill" is not a sentence to show the customer it is about.
 *
 * So a non-admin timeline is **built**, not filtered: each row becomes a label,
 * a timestamp, a status transition and who did it. Nothing from the audit row
 * reaches the page unless this function puts it there, which means a field
 * added to the audit trail tomorrow is invisible by default rather than exposed
 * by default.
 *
 * @param {object} options
 * @param {string} options.claimId  the claim whose story to tell
 * @param {string} options.role     the reader's role
 * @param {number} [options.limit]  most-recent cap; a claim's history is short,
 *                                  but a refund loop could make it long
 */
exports.buildClaimTimeline = async ({ claimId, role, limit = 50 }) => {
  const isAdmin = role === ROLES.ADMIN;

  const filter = { claimId };
  if (!isAdmin) {
    // Our own budget bookkeeping. It explains nothing to the customer or the
    // brand and it names an internal cost split.
    filter.action = { $nin: CLAIM_TIMELINE_INTERNAL_ACTIONS };
  }

  const rows = await VoucherClaimHistory.find(filter)
    // Oldest first: a timeline is read forwards. The listing sorts the other
    // way because a list is scanned for the newest thing.
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();

  return rows.map((row) => {
    const entry = {
      _id: row._id,
      at: row.createdAt,
      action: row.action,
      // A sentence, not a raw enum. An unknown action still renders as
      // something rather than blank — a new action added without a label
      // should look unfamiliar, not invisible.
      label: CLAIM_TIMELINE_LABEL[row.action] || row.action,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      // "The expiry job did it" is a real answer an auditor needs, and it is
      // not sensitive — it names a role, never a person.
      by: row.performedByRole,
    };

    if (row.amount !== undefined && row.amount !== null) {
      entry.amount = row.amount;
    }

    if (isAdmin) {
      // The forensic view: the staff note, the person, and whatever the call
      // site thought was worth keeping.
      if (row.reason) entry.reason = row.reason;
      if (row.performedBy) entry.performedBy = row.performedBy;
      if (row.snapshot) entry.snapshot = row.snapshot;
      if (row.transactionId) entry.transactionId = row.transactionId;
    }

    return entry;
  });
};
