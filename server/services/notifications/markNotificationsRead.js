const mongoose = require("mongoose");
const Notification = require("../../models/Notification");
const { throwError } = require("../../utils");
const { ROLES } = require("../../constants");
const { resolveActorBrand } = require("../../helpers/brands");
const { NOTIFICATION_AUDIENCE } = require("../../constants/notification");

/**
 * Mark notifications as read.
 *
 * Pass `notificationIds` for specific rows, or `markAll: true` to clear the
 * whole feed. Scoped through `resolveActorBrand`, and the update filter carries
 * the brand id as well as the ids — so a vendor cannot mark another brand's
 * notification read by guessing an ObjectId.
 */
exports.markNotificationsRead = async (actor, payload = {}) => {
  const { notificationIds, markAll } = payload;

  if (!markAll && !notificationIds?.length) {
    throwError(422, "Provide notificationIds or set markAll to true.");
  }

  const filter = { isRead: false, isDeleted: false };

  const isAdminFeed = actor.role === ROLES.ADMIN && !payload.brandId;
  if (isAdminFeed) {
    filter.audience = NOTIFICATION_AUDIENCE.ADMIN;
  } else {
    const brand = await resolveActorBrand(actor, payload.brandId);
    filter.brandId = new mongoose.Types.ObjectId(String(brand._id));
  }

  // Kept before the id narrowing so the remaining-unread count covers the whole
  // feed, not just the rows this call touched.
  const feedFilter = { ...filter };

  if (!markAll) {
    filter._id = {
      $in: notificationIds.map((id) => new mongoose.Types.ObjectId(id)),
    };
  }

  const now = new Date();
  const result = await Notification.updateMany(filter, {
    $set: { isRead: true, readAt: now },
  });

  const unreadCount = await Notification.countDocuments(feedFilter);

  return {
    matched: result.matchedCount || 0,
    updated: result.modifiedCount || 0,
    unreadCount,
  };
};
