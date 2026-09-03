const mongoose = require("mongoose");
const { userField, brandField, customerField } = require("./validObjectId");
const {
  NOTIFICATION_AUDIENCE,
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_SEVERITY,
  NOTIFICATION_DEFAULTS,
} = require("../constants/notification");

/**
 * A persisted notification.
 *
 * Written first, delivered second: `helpers/notifications/notify.js` always
 * stores the row, then attempts email. That way the in-app bell is the source of
 * truth and a mail outage costs a delivery, not the record.
 *
 * `dedupeKey` makes a notification idempotent — the reminder job can run every
 * few hours without sending "expires in 7 days" repeatedly.
 */
const notificationSchema = new mongoose.Schema(
  {
    // Who it is addressed to. `brandId` scopes vendor notifications; `userId`
    // is who actually reads it.
    brandId: brandField,
    userId: userField,
    /**
     * The customer this is addressed to.
     *
     * A customer is not a brand, and `brandId` on a claim notification would
     * mean the vendor whose voucher was claimed — the wrong person entirely.
     * Without this column a customer's own notification feed could not be
     * queried at all: `userId` alone is shared with any vendor account on the
     * same login.
     */
    customerId: customerField,
    audience: {
      type: String,
      enum: Object.values(NOTIFICATION_AUDIENCE),
      default: NOTIFICATION_AUDIENCE.VENDOR,
      required: true,
    },
    type: {
      type: String,
      enum: Object.values(NOTIFICATION_TYPES),
      required: true,
    },
    severity: {
      type: String,
      enum: Object.values(NOTIFICATION_SEVERITY),
      default: NOTIFICATION_SEVERITY.INFO,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: NOTIFICATION_DEFAULTS.maxTitleLength,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: NOTIFICATION_DEFAULTS.maxBodyLength,
    },
    // Where it actually got delivered. IN_APP is always present.
    channels: {
      type: [{ type: String, enum: Object.values(NOTIFICATION_CHANNELS) }],
      default: [NOTIFICATION_CHANNELS.IN_APP],
    },
    emailSentAt: { type: Date },
    emailError: { type: String },
    whatsappSentAt: { type: Date },
    whatsappError: { type: String },
    // Anything the client needs to deep-link or render: subscribedId, planName,
    // daysRemaining, bucket that hit its limit.
    meta: { type: mongoose.Schema.Types.Mixed },
    // Stable identity for a logical event, e.g.
    // "SUBSCRIPTION_EXPIRING:<subscribedId>:7". Unique, so re-running the
    // reminder job cannot double-send.
    dedupeKey: { type: String, trim: true },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

// The vendor bell: newest-first, unread-first.
notificationSchema.index({ brandId: 1, isDeleted: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, isRead: 1, isDeleted: 1, createdAt: -1 });

// Sparse so the many rows without a dedupeKey do not collide on null.
notificationSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Notification", notificationSchema);
