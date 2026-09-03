const mongoose = require("mongoose");
const {
  customerField,
  userField,
  brandField,
  voucherClaimField,
  transactionField,
} = require("./validObjectId");
const {
  CLAIM_HISTORY_ACTION,
  CLAIM_PERFORMED_BY,
  VOUCHER_CLAIM_STATUS,
} = require("../constants/voucherClaim");

/**
 * Append-only audit trail for every claim transition.
 *
 * Rows are never updated or deleted — that is the whole point. Written by
 * `helpers/voucherClaims/recordClaimHistory.js`, which is deliberately
 * failure-tolerant: losing an audit row must never roll back a paid claim.
 *
 * The customer twin of `SubscribedHistory`, and deliberately a separate
 * collection rather than a shared one. The two carry different columns
 * (`fromSubscriptionId` means nothing here; `claimCode` means nothing there),
 * and a shared collection would be half-empty on every row.
 */
const voucherClaimHistorySchema = new mongoose.Schema(
  {
    claimId: { ...voucherClaimField, required: true, index: true },
    customerId: { ...customerField, index: true },
    brandId: { ...brandField, index: true },
    transactionId: transactionField,

    action: {
      type: String,
      enum: Object.values(CLAIM_HISTORY_ACTION),
      required: true,
    },
    // Null for SYSTEM actions — the stale-claim sweep has no user behind it.
    performedBy: userField,
    performedByRole: {
      type: String,
      enum: Object.values(CLAIM_PERFORMED_BY),
      required: true,
    },

    // The transition itself, so a reader does not have to infer it from order.
    fromStatus: { type: String, enum: Object.values(VOUCHER_CLAIM_STATUS) },
    toStatus: { type: String, enum: Object.values(VOUCHER_CLAIM_STATUS) },

    amount: { type: Number },
    reason: { type: String, trim: true, maxlength: 500 },

    /**
     * Free-form extras worth keeping for forensics: the pricing block as it
     * stood, the Razorpay payment id, why a promo was released.
     *
     * Untyped on purpose. An audit row's value is that it recorded whatever
     * mattered at the time, and a schema would have had to predict that.
     */
    snapshot: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true, versionKey: false },
);

voucherClaimHistorySchema.index({ claimId: 1, createdAt: -1 });
voucherClaimHistorySchema.index({ customerId: 1, createdAt: -1 });
voucherClaimHistorySchema.index({ brandId: 1, createdAt: -1 });
voucherClaimHistorySchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model(
  "VoucherClaimHistory",
  voucherClaimHistorySchema,
);
