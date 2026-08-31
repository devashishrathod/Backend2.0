const mongoose = require("mongoose");
const {
  customerField,
  userField,
  brandField,
  subBrandField,
  voucherField,
  voucherVersionField,
  transactionField,
  promoCodeField,
} = require("./validObjectId");
const { voucherPricingSchema } = require("./voucherPricingSchema");
const {
  VOUCHER_CLAIM_STATUS,
  CLAIM_REDEMPTION_MODE,
  VOUCHER_CLAIM_INDEXES,
} = require("../constants/voucherClaim");
const { PROMO_COST_BEARING_MODE } = require("../constants/promoCode");

/**
 * One customer's claim on one voucher, at one outlet, for one bill.
 *
 * The customer-facing record of a payment. `Transaction` is the money record and
 * `VoucherUsage` is the redemption ledger; this is the thing a customer opens in
 * their order history and quotes in a support conversation.
 *
 * ### Snapshots, not joins
 *
 * `offerSnapshot`, `voucherSnapshot`, `brandSnapshot` and `outletSnapshot` are
 * copies taken at claim time. Everything they copy is editable afterwards — a
 * voucher can be republished with different offers, a brand can be renamed, an
 * outlet can close. A claim from September has to still read the same in March,
 * so reports and invoices read these and never look the live record up.
 */
const claimSnapshotSchema = new mongoose.Schema(
  {},
  { _id: false, strict: false },
);

const voucherClaimSchema = new mongoose.Schema(
  {
    // ---------- who ----------
    customerId: { ...customerField, required: true, index: true },
    userId: userField,

    // ---------- what ----------
    voucherId: { ...voucherField, required: true },
    voucherVersionId: { ...voucherVersionField, required: true },
    versionNumber: { type: Number },
    // Null when the bill was below every offer's minimum and the customer simply
    // paid their bill. Not an error state — a priced outcome.
    offerId: { type: mongoose.Schema.Types.ObjectId, default: null },

    brandId: { ...brandField, required: true, index: true },
    subBrandId: { ...subBrandField, required: true },

    // ---------- frozen at claim time ----------
    offerSnapshot: { type: claimSnapshotSchema, default: undefined },
    voucherSnapshot: { type: claimSnapshotSchema, default: undefined },
    brandSnapshot: { type: claimSnapshotSchema, default: undefined },
    outletSnapshot: { type: claimSnapshotSchema, default: undefined },

    // ---------- money ----------
    billAmount: { type: Number, required: true },
    offerApplied: { type: Boolean, default: false },
    /**
     * The frozen price.
     *
     * `voucherPricingSchema` — the same block `calculateVoucherPricing` produces
     * and the transaction carries a denormalised subset of. This is the copy an
     * invoice is regenerated from.
     */
    pricing: { type: voucherPricingSchema, required: true },

    transactionId: transactionField,

    status: {
      type: String,
      enum: Object.values(VOUCHER_CLAIM_STATUS),
      default: VOUCHER_CLAIM_STATUS.PENDING,
      required: true,
      index: true,
    },
    /**
     * `TD-8F3K2Q`. Phase 1: a reference to quote. Phase 2: the redeem key.
     *
     * Issued at creation rather than on payment, so a customer who is mid-payment
     * can already be helped by support with something to quote.
     */
    claimCode: { type: String, trim: true, uppercase: true },
    redemptionMode: {
      type: String,
      enum: Object.values(CLAIM_REDEMPTION_MODE),
      default: CLAIM_REDEMPTION_MODE.AUTO,
    },

    // ---------- lifecycle ----------
    paidAt: { type: Date },
    redeemedAt: { type: Date },
    redeemedBy: userField,
    // Phase 2: when an unscanned PAID claim lapses.
    expiresAt: { type: Date },
    cancelledAt: { type: Date },
    cancelReason: { type: String, trim: true, maxlength: 500 },
    refundedAt: { type: Date },
    refundAmount: { type: Number },
    refundReason: { type: String, trim: true, maxlength: 500 },

    /**
     * ---------- the once-per-user lock ----------
     *
     * A denormalised boolean rather than a status list, because Mongo's
     * `partialFilterExpression` accepts only equality, `$exists`, comparisons
     * and `$type` — **never `$in`**. "In one of these three statuses" cannot be
     * expressed as a partial filter, so the statuses are collapsed into this
     * flag and the index keys on it.
     *
     * Set the moment the claim is **created**, not when it is paid. Waiting for
     * payment would leave the window every race needs: two checkouts open at
     * once, neither holding anything, both allowed.
     */
    holdsUsageSlot: { type: Boolean, default: false },
    isOncePerUser: { type: Boolean, default: false },

    // ---------- promo ----------
    promoCodeId: promoCodeField,
    promoCode: { type: String, trim: true, uppercase: true },
    promoDiscount: { type: Number, default: 0 },
    /**
     * How long the quoted promo discount stands.
     *
     * A reuse candidate whose quote has lapsed gets a fresh order rather than
     * the old one — the reservation behind it may already have been swept, and
     * honouring a lapsed quote silently would give a discount the ledger has no
     * record of.
     */
    promoQuotedUntil: { type: Date },
    // Frozen, so a settlement never re-derives the split from a promo code an
    // admin has since edited.
    promoCostBearing: {
      mode: {
        type: String,
        enum: Object.values(PROMO_COST_BEARING_MODE),
        default: PROMO_COST_BEARING_MODE.PLATFORM,
      },
      vendorPercent: { type: Number, default: 0 },
    },

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

/**
 * The once-per-user guarantee, enforced by the database.
 *
 * Per **offer**, not per voucher: a voucher carries several offers, and using
 * the 20%-off one does not spend the free-dessert one. A coarser index would
 * deny the second and look like a business rule rather than a bug.
 *
 * `holdsUsageSlot: true` scopes it, so a failed or refunded claim drops out of
 * the index and frees the slot without the row being deleted — the history of
 * what happened stays.
 */
voucherClaimSchema.index(
  { voucherId: 1, customerId: 1, offerId: 1 },
  {
    unique: true,
    partialFilterExpression: { holdsUsageSlot: true },
    name: VOUCHER_CLAIM_INDEXES.USAGE_SLOT,
  },
);

// One claim per transaction. `$type: "objectId"` rather than `sparse`, because
// sparse still indexes an explicit null and two claims awaiting an order would
// collide on it.
voucherClaimSchema.index(
  { transactionId: 1 },
  {
    unique: true,
    partialFilterExpression: { transactionId: { $type: "objectId" } },
    name: VOUCHER_CLAIM_INDEXES.TRANSACTION,
  },
);

voucherClaimSchema.index(
  { claimCode: 1 },
  {
    unique: true,
    partialFilterExpression: { claimCode: { $type: "string" } },
    name: VOUCHER_CLAIM_INDEXES.CLAIM_CODE,
  },
);

// Order history, vendor reporting, outlet reporting.
voucherClaimSchema.index({ customerId: 1, createdAt: -1 });
voucherClaimSchema.index({ brandId: 1, createdAt: -1 });
voucherClaimSchema.index({ subBrandId: 1, createdAt: -1 });
// The stale-PENDING sweep.
voucherClaimSchema.index({ status: 1, createdAt: 1 });
// Phase 2: unscanned claims past their window.
voucherClaimSchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.model("VoucherClaim", voucherClaimSchema);
