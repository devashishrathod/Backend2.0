const mongoose = require("mongoose");
const { customerField } = require("./validObjectId");
const { SEARCH_LIMITS } = require("../constants/search");

/**
 * One remembered search term, for one signed-in customer.
 *
 * Guests are deliberately absent. The search endpoint itself is open to them,
 * but there is no anonymous identity to key a row on — an app-generated device
 * id would put a tracking handle on our servers and still lose the history on
 * reinstall, so a guest's recent searches stay on their device.
 *
 * A row is written **only** when the caller sends `commit=true` — the app does
 * that when the customer presses Search or opens a result, never on the calls
 * it fires while they are still typing. Without that, "pizza" would arrive as
 * five rows: p, pi, piz, pizz, pizza.
 */
const searchHistorySchema = new mongoose.Schema(
  {
    customerId: { ...customerField, required: true },

    // What they typed, kept verbatim — this is what the recent list shows.
    query: {
      type: String,
      required: true,
      trim: true,
      maxlength: SEARCH_LIMITS.MAX_QUERY_LENGTH,
    },

    /**
     * Lowercased with runs of whitespace collapsed. Two things depend on it:
     * the unique index below, and the upsert that bumps an existing row.
     *
     * Without it "Pizza", "pizza" and "pizza  hut" vs "pizza hut" are separate
     * rows, and a customer's recent list fills up with the same search wearing
     * different capitalisation.
     */
    normalizedQuery: {
      type: String,
      required: true,
      trim: true,
      maxlength: SEARCH_LIMITS.MAX_QUERY_LENGTH,
    },

    // Bumped on every repeat rather than inserting again.
    searchCount: { type: Number, default: 1, min: 1 },

    lastSearchedAt: { type: Date, default: Date.now },

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

/**
 * One row per customer per term — and only among the rows that still exist.
 *
 * ⚠️ **Partial, not blanket.** A blanket unique index here breaks the delete
 * feature outright: the customer removes "pizza", searches it again, and the
 * upsert collides with the soft-deleted row it cannot see. They would get a
 * duplicate-key error naming a field they never touched, for a search that
 * worked yesterday. Excluding `isDeleted: true` from the index is what lets a
 * deleted term come back.
 *
 * This is the same trap `invoiceId_1` fell into — see CLAUDE.md.
 */
searchHistorySchema.index(
  { customerId: 1, normalizedQuery: 1 },
  {
    name: "search_history_customer_query_unique",
    unique: true,
    partialFilterExpression: { isDeleted: false },
  },
);

/** The recent list: one customer's live rows, newest search first. */
searchHistorySchema.index({ customerId: 1, isDeleted: 1, lastSearchedAt: -1 });

module.exports = mongoose.model("SearchHistory", searchHistorySchema);
