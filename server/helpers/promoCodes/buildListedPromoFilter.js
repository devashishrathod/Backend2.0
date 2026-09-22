const { buildAudienceFilter } = require("./buildAudienceFilter");

/**
 * Which codes belong in a customer's or a vendor's own listing.
 *
 * Both listings ask exactly this question and must not drift on it, so it is
 * written once. Four things decide it:
 *
 *  - **`isPublic: true`** — the opt-in. A code without the field is hidden,
 *    which is what keeps every targeted campaign out of the list; see the note
 *    on the model.
 *  - **`isActive` / `isDeleted`** — the admin's switch.
 *  - **the window** — a code that has not started, or has ended, is not on
 *    offer. ⚠️ In a query *filter* `{ validTill: null }` matches a missing field
 *    too, which is what makes a perpetual code (no end date) pass. The same
 *    comparison inside an aggregation **expression** does not, and that
 *    difference already shipped once as "every perpetual code is expired".
 *  - **the platform cap** — a code that has been fully redeemed is finished,
 *    not merely unavailable, so it is dropped rather than listed with a reason.
 *    A customer can do nothing about it, and a drawer full of dead campaigns
 *    buries the ones that work.
 *
 * Everything else — the minimum bill, the scope lists, the per-caller cap — is
 * decided per row by the evaluators, because those answers depend on who is
 * asking and what they are buying.
 *
 * @param {string} audience  PROMO_AUDIENCE value
 * @param {Date}  [now]
 */
exports.buildListedPromoFilter = (audience, now = new Date()) => ({
  isDeleted: false,
  isActive: true,
  isPublic: true,
  // Not `{ audience }` — a code written before that field existed has no value
  // and is a vendor code by definition. See `buildAudienceFilter`.
  ...buildAudienceFilter(audience),
  $and: [
    { $or: [{ validFrom: null }, { validFrom: { $lte: now } }] },
    { $or: [{ validTill: null }, { validTill: { $gte: now } }] },
    {
      $expr: {
        $or: [
          // `$ifNull` because an absent `totalUsageLimit` means "unlimited",
          // and inside an expression absent is not null.
          { $eq: [{ $ifNull: ["$totalUsageLimit", null] }, null] },
          { $lt: [{ $ifNull: ["$usedCount", 0] }, "$totalUsageLimit"] },
        ],
      },
    },
  ],
});
