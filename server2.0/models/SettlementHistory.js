const mongoose = require("mongoose");
const { brandField, userField, settlementField } = require("./validObjectId");
const {
  SETTLEMENT_STATUS,
  SETTLEMENT_ACTOR,
} = require("../constants/settlement");

/**
 * Append-only audit trail for every settlement transition.
 *
 * Rows are never updated or deleted — that is the whole point. Written only by
 * `transitionSettlement()`, which is also the only place a settlement's status
 * changes, so the trail cannot have gaps a direct `updateOne` would leave.
 *
 * *"Why was this payout late?"* is the most common question an admin has to
 * answer about a settlement, and it is unanswerable from the settlement document
 * alone: that shows where it **is**, not where it has been.
 */
const settlementHistorySchema = new mongoose.Schema(
  {
    settlementId: { ...settlementField, required: true, index: true },
    brandId: { ...brandField, index: true },
    // Copied, so a statement query does not have to join to show it.
    settlementNumber: { type: String, trim: true },

    fromStatus: { type: String, enum: Object.values(SETTLEMENT_STATUS) },
    toStatus: {
      type: String,
      enum: Object.values(SETTLEMENT_STATUS),
      required: true,
    },

    // Null for SYSTEM actions — the build job has no person behind it.
    performedBy: userField,
    performedByRole: {
      type: String,
      enum: Object.values(SETTLEMENT_ACTOR),
      required: true,
    },

    amount: { type: Number },
    reason: { type: String, trim: true, maxlength: 500 },

    /**
     * Free-form extras worth keeping for forensics — what the release gave back,
     * whether the settlement was flagged, which attempt this was.
     *
     * Untyped on purpose: an audit row's value is that it recorded whatever
     * mattered at the time, and a schema would have had to predict that.
     */
    snapshot: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true, versionKey: false },
);

settlementHistorySchema.index({ settlementId: 1, createdAt: -1 });
settlementHistorySchema.index({ brandId: 1, createdAt: -1 });
settlementHistorySchema.index({ toStatus: 1, createdAt: -1 });

module.exports = mongoose.model("SettlementHistory", settlementHistorySchema);
