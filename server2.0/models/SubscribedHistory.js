const mongoose = require("mongoose");
const {
  brandField,
  userField,
  subscribedField,
  subscriptionField,
  transactionField,
} = require("./validObjectId");
const {
  SUBSCRIPTION_HISTORY_ACTION,
  HISTORY_PERFORMED_BY,
  SUBSCRIPTION_SOURCE,
  MANUAL_PAYMENT_MODES,
} = require("../constants/subscription");

/**
 * Append-only audit trail for every subscription transition.
 *
 * Rows are never updated or deleted — that is the whole point. Written by
 * `helpers/subscribeds/recordSubscribedHistory.js`, which is deliberately
 * failure-tolerant: losing an audit row must never roll back an activation.
 */
const subscribedHistorySchema = new mongoose.Schema(
  {
    brandId: { ...brandField, required: true, index: true },
    subscribedId: subscribedField,
    transactionId: transactionField,
    action: {
      type: String,
      enum: Object.values(SUBSCRIPTION_HISTORY_ACTION),
      required: true,
    },
    // Null for SYSTEM actions (the expiry job has no user behind it).
    performedBy: userField,
    performedByRole: {
      type: String,
      enum: Object.values(HISTORY_PERFORMED_BY),
      required: true,
    },
    fromSubscriptionId: subscriptionField,
    toSubscriptionId: subscriptionField,
    source: { type: String, enum: Object.values(SUBSCRIPTION_SOURCE) },
    paymentMode: { type: String, enum: Object.values(MANUAL_PAYMENT_MODES) },
    amount: { type: Number },
    startDate: { type: Date },
    endDate: { type: Date },
    reason: { type: String, trim: true, maxlength: 500 },
    // Free-form extras worth keeping for forensics: the pricing block, the
    // entitlements applied, overflow warnings on a grandfathered downgrade.
    snapshot: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true, versionKey: false },
);

subscribedHistorySchema.index({ brandId: 1, createdAt: -1 });
subscribedHistorySchema.index({ subscribedId: 1, createdAt: -1 });

module.exports = mongoose.model("SubscribedHistory", subscribedHistorySchema);
