const mongoose = require("mongoose");
const { SUBSCRIPTION_TYPES } = require("../constants");
const { DISCOUNT_TYPES } = require("../constants/subscription");

/**
 * A metered pool. `isUnlimited` wins over `limit` — when it is true the limit
 * is ignored entirely (and is left at 0 for clarity).
 *
 * `limit: 0` with `isUnlimited: false` means the feature is **not in the plan**,
 * which is why there is no separate `isEnabled` flag: one value expresses both
 * "excluded" and "capped", and the gate produces a different message for each.
 */
const meteredEntitlementSchema = new mongoose.Schema(
  {
    limit: { type: Number, default: 0, min: 0 },
    isUnlimited: { type: Boolean, default: false },
  },
  { _id: false },
);

const flagEntitlementSchema = new mongoose.Schema(
  { isEnabled: { type: Boolean, default: false } },
  { _id: false },
);

/**
 * Machine-readable plan limits. This — never `features[]` — is what the gates
 * enforce.
 *
 * `features[]` below stays free-text and display-only: an admin can rename,
 * reorder or delete anything in it and no business rule changes. Enforcement
 * reads `entitlements` through `helpers/subscriptions/resolveEntitlements.js`,
 * which falls back to parsing `features[]` only for plans created before this
 * field existed.
 *
 * Four *independent* pools — none draws from another:
 *   subBrands  <- SubBrand rows with outletType OUTLET
 *   franchises <- SubBrand rows with outletType FRANCHISE
 *   vouchers   <- Voucher rows in a live status (see recountBrandUsage)
 *   showcase   <- ShowcaseSection rows
 *
 * `dealPack` has no domain to gate yet and `prioritySupport` is informational,
 * so both stay plain flags.
 */
const entitlementsSchema = new mongoose.Schema(
  {
    subBrands: { type: meteredEntitlementSchema, default: () => ({}) },
    franchises: { type: meteredEntitlementSchema, default: () => ({}) },
    vouchers: { type: meteredEntitlementSchema, default: () => ({}) },
    showcase: { type: meteredEntitlementSchema, default: () => ({}) },
    dealPack: { type: flagEntitlementSchema, default: () => ({}) },
    prioritySupport: { type: flagEntitlementSchema, default: () => ({}) },
  },
  { _id: false },
);

const subscriptionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    // Pre-tax, pre-discount list price. GST is applied on top of this unless
    // Setting.vendor.subscription.isGstInclusive is on.
    price: { type: Number, required: true, min: 0 },
    // Cosmetic "was ₹X" figure for the plan card. Never used in any maths.
    strikePrice: { type: Number, min: 0 },
    discountType: {
      type: String,
      enum: Object.values(DISCOUNT_TYPES),
      default: DISCOUNT_TYPES.PERCENT,
    },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    discountAmount: { type: Number, default: 0, min: 0 },
    type: {
      type: String,
      enum: Object.values(SUBSCRIPTION_TYPES),
      required: true,
    },
    durationInDays: { type: Number },
    durationInYears: { type: Number },
    benefits: { type: [String], default: [] },
    limitations: { type: [String], default: [] },
    // Display only. See entitlementsSchema above.
    features: {
      type: [
        {
          title: { type: String, trim: true, required: true },
          value: { type: String, trim: true },
          available: { type: Boolean, default: true },
          _id: false,
        },
      ],
      default: [],
    },
    entitlements: { type: entitlementsSchema, default: () => ({}) },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

subscriptionSchema.index({ isActive: 1, isDeleted: 1, price: 1 });

module.exports = mongoose.model("Subscription", subscriptionSchema);
