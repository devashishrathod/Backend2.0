const mongoose = require("mongoose");
const VoucherClaim = require("../../models/VoucherClaim");
const { throwError } = require("../../utils");
const { VOUCHER_CLAIM_STATUS } = require("../../constants/voucherClaim");

/**
 * ⚠️ `$match` in an aggregation does **not** cast, unlike a `find`. A string id
 * here matches nothing at all — and a guard that silently matches nothing is a
 * guard that always passes, which is the worst way for this particular one to
 * fail.
 */
const toId = (value) =>
  value instanceof mongoose.Types.ObjectId
    ? value
    : new mongoose.Types.ObjectId(String(value));

/**
 * The claim states that still have somebody waiting on the other side.
 *
 * `PENDING` is an order the customer has open right now — money not taken, but
 * they are mid-checkout. `PAID` is worse: they have been charged for a discount
 * they have not used yet, and in Phase 2 the claim sits here until the outlet
 * scans it.
 *
 * ⚠️ Everything else is deliberately absent. `REDEEMED` is finished — the
 * customer got what they paid for, and the claim row keeps the history. `FAILED`,
 * `CANCELLED`, `EXPIRED` and `REFUNDED` all ended without anybody left holding
 * something. Blocking on those would make a voucher undeletable for ever on the
 * strength of an order that fell over months ago.
 */
const LIVE_CLAIM_STATUSES = Object.freeze([
  VOUCHER_CLAIM_STATUS.PENDING,
  VOUCHER_CLAIM_STATUS.PAID,
]);

/**
 * Refuse to delete a voucher that customers are still holding (V-6, V-8).
 *
 * ### 🔴 This applies to admins too, and that is the decision, not an oversight
 *
 * Every other guard in this codebase exempts ADMIN, because an admin overriding
 * a vendor's own rule is the point of being an admin. This one does not, because
 * the person it protects is neither of them. A customer who has paid for a
 * discount is owed it; no level of internal permission changes that, and an
 * admin clicking delete has no way of knowing they are about to strand someone.
 *
 * So the refusal carries what the caller needs to act: how many, in what state,
 * and what to do instead.
 *
 * @param {string|object} voucherId
 * @param {{ session?: object }} [options]
 */
exports.assertNoLiveClaims = async (voucherId, { session } = {}) => {
  const rows = await VoucherClaim.aggregate([
    { $match: { voucherId: toId(voucherId), status: { $in: LIVE_CLAIM_STATUSES } } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]).session(session);

  if (!rows.length) return;

  const breakdown = {};
  let liveClaims = 0;
  rows.forEach((row) => {
    breakdown[row._id] = row.count;
    liveClaims += row.count;
  });

  throwError(409, exports.liveClaimsMessage(liveClaims, breakdown), {
    liveClaims,
    breakdown,
    /**
     * Pause is the honest alternative and it exists (V-5). Telling somebody
     * "no" without telling them the thing that does work is how a guard becomes
     * something people route around.
     */
    suggestedAction:
      "Pause it instead — that takes it off the customer app immediately and leaves these claims intact. You can delete it once they are settled.",
  });
};

/** Says what is in the way, in the order a person would ask. */
exports.liveClaimsMessage = (liveClaims, breakdown = {}) => {
  const paid = breakdown[VOUCHER_CLAIM_STATUS.PAID] || 0;
  const pending = breakdown[VOUCHER_CLAIM_STATUS.PENDING] || 0;
  const noun = liveClaims === 1 ? "customer is" : "customers are";

  const parts = [];
  if (paid) parts.push(`${paid} already paid`);
  if (pending) parts.push(`${pending} still checking out`);

  return `${liveClaims} ${noun} holding this voucher right now (${parts.join(", ")}), so it cannot be deleted.`;
};

exports.LIVE_CLAIM_STATUSES = LIVE_CLAIM_STATUSES;
