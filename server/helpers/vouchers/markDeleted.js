const { VOUCHER_STATUSES } = require("../../constants/voucher");

/**
 * The one place a delete is written (V-6, V-11).
 *
 * ### 🔴 `isDeleted` and `status` are one decision, not two
 *
 * `isDeleted` is the operational flag — every read in the codebase filters on
 * it, and that is not changing. `status: DELETED` is the display half: a
 * boolean cannot be shown to anybody, so before this a panel listing a voucher
 * had no word for what had happened to it.
 *
 * Keeping them in step is not a convention anybody has to remember, because
 * there is nothing to remember: this function returns both, and it is what
 * every delete writes. A voucher reading `DELETED` with `isDeleted: false`
 * would be visible in every listing while claiming to be gone; the opposite
 * would be invisible with no explanation. Neither can be built from here.
 *
 * `isActive: false` rides along for the same reason — it is the third field the
 * rest of the codebase reads to mean "not in circulation", and a delete that
 * left it `true` would be a deleted row that still looked available to anything
 * checking activity rather than deletion.
 *
 * @param {{ userId: string, reason?: string, at?: Date }} by
 * @returns {object} a `$set` payload, the same for `Voucher` and `VoucherVersion`
 */
exports.voucherDeletionFields = ({ userId, reason, at } = {}) => ({
  isDeleted: true,
  status: VOUCHER_STATUSES.DELETED,
  isActive: false,
  deletedAt: at || new Date(),
  deletedBy: userId || null,
  /**
   * Empty string is stored as `null`, not `""`. A blank reason and no reason
   * are the same thing, and two spellings of it means every reader has to check
   * for both.
   */
  deleteReason: (typeof reason === "string" ? reason.trim() : "") || null,
});
