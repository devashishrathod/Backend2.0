const Notification = require("../../models/Notification");
const { pagination } = require("../../utils");
const {
  buildNotificationScope,
  notificationProjection,
} = require("./notificationScope");

/**
 * The notification list behind the bell — **one endpoint, four shapes**.
 *
 * A customer sees their own rows, a vendor their brand's, an admin either the
 * admin feed or any brand's, and an outlet manager is refused. Scope and
 * projection both come from the token, via `buildNotificationScope` and
 * `notificationProjection`.
 *
 * ### Why not a separate `/notifications/customer`
 *
 * The same reason `/refunds`, `/settlements` and `/voucher-claims` are single
 * endpoints: two surfaces means remembering in two places that a customer must
 * never see `emailError`, `dedupeKey` or a raw `meta`. Forgetting once is a
 * leak, and it shows up on a detail screen nobody re-reads.
 */
exports.getAllNotifications = async (actor, query = {}) => {
  let { page, limit, type, isRead } = query;
  page = page ? Number(page) : 1;
  limit = limit ? Number(limit) : 20;

  /**
   * The scope is kept apart from the caller's filters on purpose — the badge
   * below counts against the scope alone, and spreading a `match` that already
   * carried `type` would make the badge move when somebody filtered the list.
   */
  const scope = await buildNotificationScope(actor, query);
  const match = { ...scope };

  if (type) match.type = type;
  if (typeof isRead !== "undefined") {
    match.isRead = isRead === "true" || isRead === true;
  }

  const pipeline = [
    { $match: match },
    { $project: notificationProjection(actor) },
    // Unread first, then newest.
    { $sort: { isRead: 1, createdAt: -1 } },
  ];

  const result = await pagination(
    Notification,
    pipeline,
    page,
    limit,
    "notification",
    /**
     * ⚠️ `allowEmpty` — an empty inbox is a **state**, not a missing resource.
     *
     * `pagination` otherwise throws `404 "No any notification found"`, and the
     * bell is the first thing a new customer taps: they would open it and get an
     * error screen for the entirely normal situation of having no notifications
     * yet. The claim listing hit exactly this and was given the same flag; the
     * rule in `pagination`'s own comment is *"404 when the caller named
     * something that does not exist; an empty page when they asked a question
     * whose honest answer is none"*.
     *
     * ⚠️ This changes the vendor feed's empty response too — from `404` to
     * `200` with `data: []`. That is the same fix for the same reason, and a
     * client treating 404 as "empty" keeps working because it now simply never
     * arrives.
     */
    { allowEmpty: true },
  );

  return {
    ...result,
    /**
     * The badge, in the same round trip — the inbox needs it on every open, and
     * a second endpoint for one number is a wasted trip.
     *
     * ⚠️ Counted against the **scope**, not the filtered page. A reader who
     * opens the feed with `?type=REFUND_APPROVED` still needs to know how many
     * unread remain overall; a count that moved with the filter would make the
     * badge disagree with the bell that opened it.
     */
    unreadCount: await Notification.countDocuments({
      ...scope,
      isRead: false,
    }),
  };
};
