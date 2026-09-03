const mongoose = require("mongoose");
const { brandField, systemVerifyField, userField } = require("./validObjectId");
const { SYSTEM_VERIFICATION_STATUS } = require("../constants");
const {
  BRAND_VERIFICATION_ACTION,
  BRAND_VERIFICATION_ACTOR,
  BRAND_VERIFICATION_LIMITS,
} = require("../constants/brandVerification");

// Append-only audit trail of a brand's verification lifecycle.
// Every system run, review toggle, approval and rejection is its own row —
// nothing here is ever mutated, so "rejected 3 times, on these dates, by these
// admins, for these reasons" is answerable from this collection alone.
const brandVerificationHistorySchema = new mongoose.Schema(
  {
    // Both are covered by the compound { …, createdAt: -1 } indexes below.
    brandId: {
      ...brandField,
      required: true,
    },
    systemVerifyId: {
      ...systemVerifyField,
      required: true,
    },
    action: {
      type: String,
      enum: Object.values(BRAND_VERIFICATION_ACTION),
      required: true,
    },
    performedByType: {
      type: String,
      enum: Object.values(BRAND_VERIFICATION_ACTOR),
      required: true,
    },
    // Null only for events raised by an unattended job. System runs triggered
    // from the vendor's onboarding still carry the vendor's user id here.
    performedBy: userField,
    // Which system-verification attempt this event belongs to (1 = first run).
    attemptNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    // Denormalised brand identifiers so the trail stays readable/searchable
    // even if the brand document later changes.
    brandUniqueId: { type: String, index: true },
    merchantId: { type: String, index: true },
    score: { type: Number },
    previousStatus: {
      type: String,
      enum: Object.values(SYSTEM_VERIFICATION_STATUS),
    },
    newStatus: {
      type: String,
      enum: Object.values(SYSTEM_VERIFICATION_STATUS),
    },
    // Rejection reason, or the optional admin note on approve/review.
    reason: {
      type: String,
      trim: true,
      maxlength: BRAND_VERIFICATION_LIMITS.MAX_REASON_LENGTH,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

brandVerificationHistorySchema.index({ brandId: 1, createdAt: -1 });
brandVerificationHistorySchema.index({ systemVerifyId: 1, createdAt: -1 });
brandVerificationHistorySchema.index({ performedBy: 1, createdAt: -1 });
brandVerificationHistorySchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model(
  "BrandVerificationHistory",
  brandVerificationHistorySchema,
);
