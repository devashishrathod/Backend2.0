const mongoose = require("mongoose");
const Notification = require("../../models/Notification");
const { throwError } = require("../../utils");
const { buildNotificationScope } = require("./notificationScope");

/**
 * Mark notifications as read.
 *
 * Pass `notificationIds` for specific rows, or `markAll: true` to clear the
 * whole feed.
 *
 * ⚠️ The scope is in the **update filter**, not checked before it. Reading the
 * rows first and then updating by id would leave a window between the two, and
 * more importantly it would put the ownership decision in a second place. Here a
 * customer who guesses another customer's notification id simply matches
 * nothing — `matched: 0` — because `customerId` is part of the same query that
 * writes.
 *
 * Scope comes from `buildNotificationScope`, shared with the list, so the two
 * can never disagree about who may touch which row.
 */
exports.markNotificationsRead = async (actor, payload = {}) => {
  const { notificationIds, markAll } = payload;

  if (!markAll && !notificationIds?.length) {
    throwError(422, "Provide notificationIds or set markAll to true.");
  }

  const scope = await buildNotificationScope(actor, payload);
  const filter = { ...scope, isRead: false };

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
