const mongoose = require("mongoose");
const {
  voucherField,
  voucherVersionField,
  voucherClaimField,
  subBrandField,
  brandField,
  customerField,
  userField,
  transactionField,
} = require("./validObjectId");
const { VOUCHER_USAGE_TYPE } = require("../constants/voucher");

/**
 * The immutable record that a voucher offer was consumed.
 *
 * One row per redeemed claim. This is the *consumption ledger* — what
 * enforces `ONCE_PER_USER`, what a redemption report counts, and what a refund
 * has to reverse. The claim itself (`VoucherClaim`) carries the lifecycle; this
 * carries the fact.
 *
 * ---
 *
 * **This model was previously unwritable**, which is why nothing in the codebase
 * ever wrote to it. Four things blocked it, all fixed here:
 *
 *  1. `orderId` was `required` and referenced an `Order` model that does not
 *     exist in this codebase and never has.
 *  2. `offerId` referenced `VoucherOffer`, also not a model — offers are
 *     embedded subdocuments inside `VoucherVersion.offers`.
 *  3. The unique index on `{voucherId, customerId}` forced *every* voucher to
 *     behave as ONCE_PER_USER, even though `usageType: MULTIPLE` is valid and
 *     is the default.
 *  4. There was no `brandId`, no `transactionId` and no `isDeleted`, so a row
 *     could not be tied to the money that produced it, scoped to a vendor, or
 *     soft-deleted the way every other document in this codebase is.
 */
const voucherUsageSchema = new mongoose.Schema(
  {
    /**
     * The idempotency anchor.
     *
     * Settlement writes this row inside a sequence of steps that can be
     * re-run — by the webhook, the browser callback, or the resume job. A
     * unique claim id is what makes "write the usage" safe to attempt as many
     * times as it takes.
     */
    voucherClaimId: { ...voucherClaimField, required: true },
    transactionId: { ...transactionField, required: true },

    customerId: { ...customerField, required: true },
    userId: userField,

    voucherId: { ...voucherField, required: true },
    voucherVersionId: { ...voucherVersionField, required: true },
    // Which published version was live when this was consumed. A voucher can be
    // republished; this fixes the row to the version it actually used.
    versionNumber: { type: Number, required: true },

    /**
     * The offer inside `VoucherVersion.offers` that was applied.
     *
     * A plain ObjectId, not a ref: there is no VoucherOffer model to populate
     * from. **Nullable** — a claim placed when the bill sat below every offer's
     * minimum consumes no offer at all, and still gets a row here so that
     * "how many times was this voucher transacted at this outlet" stays a
     * single, uniform question.
     */
    offerId: { type: mongoose.Schema.Types.ObjectId, default: null },
    offerApplied: { type: Boolean, default: false },

    brandId: { ...brandField, required: true },
    subBrandId: { ...subBrandField, required: true },

    // Frozen at consumption. The version's offers can change afterwards; what
    // this customer was actually given cannot.
    offerSnapshot: {
      title: { type: String },
      minBillAmount: { type: Number },
      discountType: { type: String },
      discountValue: { type: Number },
      maxDiscountAmount: { type: Number, default: null },
      discountApplicableOn: { type: String },
    },

    // ---------- money, as it stood ----------
    billAmount: { type: Number, required: true, min: 0 },
    discountAmount: { type: Number, required: true, min: 0, default: 0 },
    promoDiscount: { type: Number, default: 0 },
    convenienceFee: { type: Number, default: 0 },
    // What the customer actually paid, so this row alone answers the question
    // without joining the transaction.
    paidAmount: { type: Number, required: true, min: 0 },

    // ---------- usage limits ----------
    usageType: {
      type: String,
      enum: Object.values(VOUCHER_USAGE_TYPE),
      default: VOUCHER_USAGE_TYPE.MULTIPLE,
    },
    /**
     * Denormalised from `offerSnapshot.usageType`, because a
     * `partialFilterExpression` supports only equality and a handful of
     * operators — `$in` is not among them. A boolean is the one shape the
     * partial unique index below can filter on.
     */
    isOncePerUser: { type: Boolean, default: false },

    usedAt: { type: Date, default: Date.now },

    // ---------- reversal ----------
    // A full refund returns the once-per-user slot. The row is never deleted —
    // it is the record that the consumption happened and was undone.
    /**
     * This redemption could not take the once-per-user slot it was entitled to.
     *
     * Set when the stale-claim sweep released a slot, another claim took it, and
     * this payment captured afterwards. The money was already taken, so refusing
     * to settle would leave the customer charged with nothing to show for it —
     * the usage is written without the slot instead, flagged here, and an admin
     * is told.
     *
     * A business conflict to resolve, not a technical failure to retry.
     */
    slotConflict: { type: Boolean, default: false },

    isReversed: { type: Boolean, default: false },
    reversedAt: { type: Date },
    reversalReason: { type: String, trim: true, maxlength: 300 },

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

/**
 * ONCE_PER_USER, enforced **per offer** — not per voucher.
 *
 * `usageType` lives on the offer (`VoucherVersion.offers[].usageType`), so one
 * version can legitimately carry a "first order 50% off" that is ONCE_PER_USER
 * alongside a "10% off always" that is MULTIPLE. Locking on `{voucherId,
 * customerId}` — as this model used to — would block a customer from the second
 * offer the moment they used the first, taking away something they were
 * entitled to.
 *
 * The partial filter does two jobs:
 *   `isOncePerUser: true`  — MULTIPLE offers are not in the index at all, so
 *                            they are never constrained
 *   `isReversed: false`    — a refunded consumption releases the slot
 *
 * A no-offer claim carries `offerId: null` and `isOncePerUser: false`, so it
 * never touches this index either.
 */
voucherUsageSchema.index(
  { voucherId: 1, customerId: 1, offerId: 1 },
  {
    unique: true,
    partialFilterExpression: { isOncePerUser: true, isReversed: false },
    name: "voucherUsage_oncePerUser",
  },
);

// One usage per claim, in both directions.
voucherUsageSchema.index(
  { voucherClaimId: 1 },
  { unique: true, name: "voucherUsage_claim_unique" },
);

voucherUsageSchema.index({ customerId: 1, usedAt: -1 });
voucherUsageSchema.index({ voucherId: 1, usedAt: -1 });
voucherUsageSchema.index({ brandId: 1, usedAt: -1 });
voucherUsageSchema.index({ subBrandId: 1, usedAt: -1 });
voucherUsageSchema.index({ transactionId: 1 });

module.exports = mongoose.model("VoucherUsage", voucherUsageSchema);
