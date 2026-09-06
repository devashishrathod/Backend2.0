/**
 * The one definition of "a brand a customer may see".
 *
 * ### ⚠️ Why this is a shared helper and not three inline filters
 *
 * It was three inline filters, and they agreed on `{isDeleted: false,
 * isActive: true}` and nothing else — no surface checked whether the brand had
 * ever been **verified**. That is how six brands whose owning `User` no longer
 * existed sat in the customer directory as empty shells: they were not deleted
 * and not deactivated, so every filter passed them.
 *
 * A predicate that decides what the public can see belongs in one place. Five
 * copies is five chances for the next change to land in four of them.
 *
 * ### The three flags, and why all three
 *
 * `reviewBrandVerification` writes all of these together, so they cannot
 * disagree — but each answers a different question, and only the combination is
 * safe:
 *
 * | Flag | Set by | Without it |
 * |---|---|---|
 * | `isApproved: true` | APPROVED | a brand that never finished onboarding shows |
 * | `isRejected: { $ne: true }` | REJECTED | belt-and-braces; reject already clears `isApproved` |
 * | `isRevoked: { $ne: true }` | REVOKED | same, for a brand whose approval was taken back |
 *
 * ⚠️ `$ne: true` rather than `false`, because both flags are **absent** on every
 * brand written before they existed. A query filter treats absent and `false`
 * alike; `isRejected: false` would silently exclude every older brand. This is
 * the same shape `CLAUDE.md` records for `requiresAdminApproval` and for
 * `isRefunded` in the settlement eligibility filter.
 *
 * ⚠️ This is **not** `SystemVerify.status`. That document is the audit trail and
 * a brand can have several attempts; `Brand.isApproved` is the current verdict,
 * denormalised onto the row precisely so a listing does not need a `$lookup` per
 * brand to decide whether to show it.
 */

/**
 * @param {object} [extra] merged on top — for `_id`, a `brandId`, and so on.
 * @returns {object} a Mongo filter
 */
const customerVisibleBrandFilter = (extra = {}) => ({
  isDeleted: false,
  isActive: true,
  isApproved: true,
  isRejected: { $ne: true },
  isRevoked: { $ne: true },
  ...extra,
});

/**
 * The same rule as an aggregation `$expr`, for use inside a `$lookup` pipeline
 * where the brand is joined rather than matched directly.
 *
 * ⚠️ Written with `$ne` on the raw field rather than `$eq: false`, for the
 * absent-field reason above — and in an **expression** the difference is not
 * subtle: `{$eq: ["$isRejected", false]}` is `false` when the field is missing,
 * which would hide every older brand rather than show it.
 */
const customerVisibleBrandExpr = (brandField = "$isApproved") => ({
  $and: [
    { $eq: [{ $ifNull: ["$isDeleted", false] }, false] },
    { $eq: [{ $ifNull: ["$isActive", false] }, true] },
    { $eq: [{ $ifNull: [brandField, false] }, true] },
    { $ne: [{ $ifNull: ["$isRejected", false] }, true] },
    { $ne: [{ $ifNull: ["$isRevoked", false] }, true] },
  ],
});

module.exports = { customerVisibleBrandFilter, customerVisibleBrandExpr };
