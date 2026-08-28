const mongoose = require("mongoose");
const { brandField, userField } = require("./validObjectId");
const {
  BRAND_STATUS_ACTION,
  BRAND_STATUS_ACTOR,
  BRAND_STATUS_LIMITS,
} = require("../constants/brandStatus");

/**
 * Append-only audit trail of the two admin switches on a brand — the vendor's
 * account (`User.isActive`) and customer visibility (`Brand.isActive`).
 *
 * Same shape and reasoning as BrandVerificationHistory: nothing here is ever
 * mutated, so "deactivated three times, on these dates, by these admins, for
 * these reasons" is answerable from this collection alone. The denormalised
 * fields on Brand (`account*`, `customerVisibility*`) only ever hold the
 * *latest* value — which is exactly what an audit question cannot be answered
 * from.
 *
 * One row per switch that actually moved: a call that flips both writes two
 * rows, so each row is unambiguously about one thing.
 */
const brandStatusHistorySchema = new mongoose.Schema(
  {
    brandId: { ...brandField, required: true },
    // The vendor whose login moved with the brand. Denormalised because the
    // brand's `userId` could in principle be reassigned, and this row has to
    // stay true about who was actually locked out at the time.
    userId: userField,
    action: {
      type: String,
      enum: Object.values(BRAND_STATUS_ACTION),
      required: true,
    },
    performedByType: {
      type: String,
      enum: Object.values(BRAND_STATUS_ACTOR),
      required: true,
    },
    // Null only for events raised by an unattended job.
    performedBy: userField,
    // Internal note. Optional on deactivate, never present on activate.
    reason: {
      type: String,
      trim: true,
      maxlength: BRAND_STATUS_LIMITS.MAX_REASON_LENGTH,
    },
    // Denormalised identifiers so the trail stays readable and searchable even
    // if the brand document is later renamed.
    brandUniqueId: { type: String, index: true },
    merchantId: { type: String, index: true },
    // Both switches, before and after. A trail that recorded only the brand
    // could not explain why a vendor could — or could not — still log in, since
    // `PUT /brands/update` can move `Brand.isActive` on its own.
    previousState: {
      brandIsActive: { type: Boolean },
      userIsActive: { type: Boolean },
    },
    newState: {
      brandIsActive: { type: Boolean },
      userIsActive: { type: Boolean },
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

// "This brand's history, newest first" — the only read this collection has.
brandStatusHistorySchema.index({ brandId: 1, createdAt: -1 });
// "Everything this admin switched off" — accountability queries.
brandStatusHistorySchema.index({ performedBy: 1, createdAt: -1 });
brandStatusHistorySchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model(
  "BrandStatusHistory",
  brandStatusHistorySchema,
);
