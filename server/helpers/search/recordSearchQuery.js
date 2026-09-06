const Customer = require("../../models/Customer");
const SearchHistory = require("../../models/SearchHistory");

/**
 * Remember one search, for one signed-in customer.
 *
 * ⚠️ **This must never fail a search.** The results are the answer; the history
 * row is a side effect. Whatever goes wrong here — a duplicate-key race between
 * two devices, an index still building, a Customer row that vanished mid-flight
 * — the customer still gets what they searched for. Same trade
 * `helpers/notifications/sendQuietly.js` makes, and the same reason: the useful
 * work has already happened.
 *
 * That is the one justification for a `try/catch` here. It is not branching on
 * an error type; it is refusing to let a bookkeeping write take down a read.
 *
 * Silently doing nothing is correct for three callers:
 *   - a guest (no `userId`) — their history lives on their device
 *   - a vendor or admin previewing the app — they have no Customer row
 *   - any call without `commit` — the app sends that only when the customer
 *     presses Search or opens a result, never while they are still typing
 */
exports.recordSearchQuery = async ({ userId, query, normalizedQuery, limit }) => {
  try {
    if (!userId || !normalizedQuery) return null;

    // Not `resolveCustomerByUserId` — that throws 404 for a caller who simply
    // is not a customer, which is a perfectly ordinary thing to be here.
    const customer = await Customer.findOne({
      userId,
      isActive: true,
      isDeleted: false,
    })
      .select("_id")
      .lean();
    if (!customer) return null;

    /**
     * Upsert, not insert.
     *
     * Searching "pizza" four times is one entry that moved to the top, not four
     * rows pushing everything else out of a list of twenty. The partial unique
     * index on `{customerId, normalizedQuery}` enforces the same thing at the
     * storage layer.
     *
     * `isDeleted: false` is in the filter, so a term the customer deleted comes
     * back as a **new** row rather than resurrecting the old one with its old
     * count — which is what "I removed that" should mean.
     */
    const row = await SearchHistory.findOneAndUpdate(
      { customerId: customer._id, normalizedQuery, isDeleted: false },
      {
        // Kept fresh so the list shows the latest casing they used.
        $set: { query, lastSearchedAt: new Date() },
        $inc: { searchCount: 1 },
      },
      // `returnDocument: "after"`, not `new: true` — the latter is deprecated
      // in Mongoose 9 and warns on every write.
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );

    /**
     * Trim to the configured cap, **after** the upsert.
     *
     * Pruning first would delete a row to make space and then find the "new"
     * search was one the customer already had — leaving them one entry short
     * for no reason.
     */
    const stale = await SearchHistory.find({
      customerId: customer._id,
      isDeleted: false,
    })
      .sort({ lastSearchedAt: -1 })
      .skip(limit)
      .select("_id")
      .lean();

    if (stale.length) {
      await SearchHistory.updateMany(
        { _id: { $in: stale.map((doc) => doc._id) } },
        { $set: { isDeleted: true } },
      );
    }

    return row;
  } catch (error) {
    console.error("[search] history write failed:", error?.message);
    return null;
  }
};
