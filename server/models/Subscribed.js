const mongoose = require("mongoose");
const {
  subscriptionField,
  brandField,
  userField,
  transactionField,
  subscribedField,
} = require("./validObjectId");
const { pricingSchema } = require("./pricingSchema");
const {
  SUBSCRIBED_STATUS,
  SUBSCRIPTION_SOURCE,
  MANUAL_PAYMENT_MODES,
} = require("../constants/subscription");

/**
 * One purchased (or admin-granted) subscription instance.
 *
 * This document is the single source of truth for whether a brand is
 * subscribed. `status` + `endDate` decide it; `Brand.isSubscribed` and
 * `Brand.subscribedId` are only a denormalized cache kept in step by
 * `helpers/subscribeds/syncBrandSubscriptionState.js`.
 *
 * The legacy booleans (isActive / isExpired / isUpgraded) are still written so
 * older readers keep working, but they are *derived* from `status` — never the
 * other way round. New code must read `status`.
 */
const subscribedSchema = new mongoose.Schema(
  {
    // The vendor who owns the brand. Previously written by the service but
    // absent from this schema, so it was silently dropped on every insert.
    userId: userField,
    brandId: brandField,
    subscribedBy: userField,
    upgradedBy: userField,
    grantedByAdminId: userField,
    transactionId: transactionField,
    subscriptionId: subscriptionField,
    upgradedTo: subscribedField,
    downgradedTo: subscribedField,
    previousSubscribedId: subscribedField,

    // ---------- validity ----------
    durationInDays: { type: Number },
    durationInYears: { type: Number },
    startDate: { type: Date },
    endDate: { type: Date },

    // ---------- money ----------
    // Kept flat for backwards compatibility; `pricing` is the full breakdown.
    price: { type: Number },
    discount: { type: Number },
    paidAmount: { type: Number, default: 0 },
    dueAmount: { type: Number, default: 0 },
    pricing: { type: pricingSchema, default: () => ({}) },

    // ---------- how it came to be ----------
    status: {
      type: String,
      enum: Object.values(SUBSCRIBED_STATUS),
      default: SUBSCRIBED_STATUS.PENDING,
    },
    source: {
      type: String,
      enum: Object.values(SUBSCRIPTION_SOURCE),
      default: SUBSCRIPTION_SOURCE.PAYMENT,
    },
    // Only set when source is ADMIN_MANUAL.
    paymentMode: {
      type: String,
      enum: Object.values(MANUAL_PAYMENT_MODES),
    },
    referenceNumber: { type: String, trim: true },
    adminNote: { type: String, trim: true, maxlength: 500 },
    cancelReason: { type: String, trim: true, maxlength: 500 },
    isFreeGrant: { type: Boolean, default: false },

    // ---------- timestamps for each transition ----------
    activatedAt: { type: Date },
    expiredAt: { type: Date },
    cancelledAt: { type: Date },
    upgradeDate: { type: Date },
    numberOfUpgrade: { type: Number, default: 0 },

    // ---------- forfeited validity (no proration, but recorded) ------------
    // Upgrading ends this plan immediately; the unused days are forfeited and
    // the policy says so upfront. They are captured here so those vendors can
    // be found later and compensated. See GET /subscribeds/admin/forfeited.
    forfeitedDays: { type: Number, default: 0, min: 0 },
    // Pro-rata rupee value of forfeitedDays, from this plan's own taxable value.
    forfeitedValue: { type: Number, default: 0, min: 0 },
    // Set once a goodwill credit or extension has been given for the forfeit.
    forfeitCompensatedAt: { type: Date },
    forfeitCompensationNote: { type: String, trim: true, maxlength: 500 },

    // ---------- renewal reminders ----------
    // Day offsets already sent, e.g. [7, 3]. Makes the reminder job idempotent
    // so it can run every few hours without re-sending.
    remindersSent: { type: [Number], default: [] },

    // ---------- derived mirrors of `status` (do not read these) ----------
    isExpired: { type: Boolean, default: false },
    isUpgraded: { type: Boolean, default: false },
    isActive: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

subscribedSchema.index({ endDate: 1, isExpired: 1 });

// The hot path: "what is this brand's live plan".
subscribedSchema.index({ brandId: 1, status: 1, endDate: -1, isDeleted: 1 });

// Drives the expiry job's sweep.
subscribedSchema.index({ status: 1, endDate: 1, isDeleted: 1 });

subscribedSchema.index({ userId: 1, isDeleted: 1 });

// Drives the reminder sweep: live plans approaching their end date.
subscribedSchema.index({ status: 1, endDate: 1, remindersSent: 1 });

// The goodwill-credit worklist: forfeits not yet compensated.
subscribedSchema.index({ forfeitedDays: 1, forfeitCompensatedAt: 1 });

/**
 * One subscription per transaction — enforced by the database, not by hope.
 *
 * `activateSubscription` checks for an existing row before creating one, but a
 * check-then-write is not atomic: two settlement attempts running together can
 * both find nothing and both insert. This index is what makes the loser fail
 * with a duplicate-key error instead, which that helper catches and turns into
 * "somebody else already activated it".
 *
 * ### ⚠️ Partial, and it has to be
 *
 * A plain unique index would treat every missing `transactionId` as the same
 * value `null` and reject all but one of them. Rows legitimately have no
 * transaction — an admin plan change writes one, and so does the Postman seeder
 * — and they are the majority. `$type: "objectId"` indexes only the rows that
 * actually carry one, which is the same shape the nullable-until-issued document
 * numbers use.
 *
 * Nothing runs `syncIndexes()` in this codebase, so on an existing deployment
 * this is created by the migration that ships with it rather than by Mongoose.
 */
subscribedSchema.index(
  { transactionId: 1 },
  {
    unique: true,
    partialFilterExpression: { transactionId: { $type: "objectId" } },
    name: "uniq_subscribed_transactionId",
  },
);

module.exports = mongoose.model("Subscribed", subscribedSchema);
