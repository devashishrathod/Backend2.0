const mongoose = require("mongoose");
const Notification = require("../../models/Notification");
const { pagination } = require("../../utils");
const { ROLES } = require("../../constants");
const { NOTIFICATION_AUDIENCE } = require("../../constants/notification");
const { resolveActorBrand } = require("../../helpers/brands");

/**
 * The notification list behind the vendor's bell.
 *
 * Scoped by `resolveActorBrand`, so a vendor can only ever read their own
 * brand's rows; an admin may pass any `brandId`, or omit it to read the
 * admin-audience feed.
 */
exports.getAllNotifications = async (actor, query = {}) => {
  let { page, limit, type, isRead } = query;
  page = page ? Number(page) : 1;
  limit = limit ? Number(limit) : 20;

  const match = { isDeleted: false };

  const isAdminFeed = actor.role === ROLES.ADMIN && !query.brandId;
  if (isAdminFeed) {
    match.audience = NOTIFICATION_AUDIENCE.ADMIN;
  } else {
    const brand = await resolveActorBrand(actor, query.brandId);
    match.brandId = new mongoose.Types.ObjectId(String(brand._id));
  }

  if (type) match.type = type;
  if (typeof isRead !== "undefined") {
    match.isRead = isRead === "true" || isRead === true;
  }

  const pipeline = [
    { $match: match },
    {
      $project: {
        type: 1,
        severity: 1,
        title: 1,
        body: 1,
        channels: 1,
        meta: 1,
        isRead: 1,
        readAt: 1,
        createdAt: 1,
        // Delivery diagnostics are useful to an admin and noise to a vendor.
        ...(actor.role === ROLES.ADMIN
          ? { emailSentAt: 1, emailError: 1, dedupeKey: 1, brandId: 1 }
          : {}),
      },
    },
    // Unread first, then newest.
    { $sort: { isRead: 1, createdAt: -1 } },
  ];

  const result = await pagination(
    Notification,
    pipeline,
    page,
    limit,
    "notification",
  );

  return {
    ...result,
    unreadCount: await Notification.countDocuments({
      ...match,
      isRead: false,
    }),
  };
};
