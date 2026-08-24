const User = require("../../models/User");
const {
  NOTIFICATION_AUDIENCE,
  NOTIFICATION_SEVERITY,
} = require("../../constants/notification");
const { ROLES } = require("../../constants");
const { notify } = require("./notify");

/**
 * Raise a notification for the admin team.
 *
 * Fans out to one row per active admin, because the feed is read per user — a
 * single shared row would be marked read by whoever opened it first and vanish
 * for everyone else.
 *
 * `dedupeKey` is suffixed per admin so the caller can pass one logical key and
 * still get one row each, without collisions on the unique index.
 *
 * Never throws, for the same reason `notify` does not: the operations that call
 * this — a failed webhook, a lapsed paying brand — must not be rolled back
 * because an alert could not be written.
 */
exports.notifyAdmins = async ({
  type,
  title,
  body,
  severity = NOTIFICATION_SEVERITY.WARNING,
  meta,
  dedupeKey,
  email = true,
  awaitEmail = false,
  mail,
}) => {
  try {
    const admins = await User.find({
      role: ROLES.ADMIN,
      isActive: true,
      isDeleted: false,
    })
      .select("_id email")
      .lean();

    if (!admins.length) {
      console.warn(`[notifyAdmins] no active admin to notify about ${type}`);
      return { created: 0 };
    }

    const results = await Promise.all(
      admins.map((admin) =>
        notify({
          userId: admin._id,
          audience: NOTIFICATION_AUDIENCE.ADMIN,
          type,
          severity,
          title,
          body,
          meta,
          dedupeKey: dedupeKey ? `${dedupeKey}:${admin._id}` : undefined,
          email,
          awaitEmail,
          mail,
        }),
      ),
    );

    return { created: results.filter((r) => r.created).length };
  } catch (error) {
    console.error(`[notifyAdmins] failed for ${type}:`, error?.message);
    return { created: 0 };
  }
};
