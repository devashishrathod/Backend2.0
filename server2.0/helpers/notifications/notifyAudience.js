const Notification = require("../../models/Notification");
const { ROLES } = require("../../constants");
const {
  NOTIFICATION_AUDIENCE,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_SEVERITY,
} = require("../../constants/notification");
const { resolveAudience } = require("./resolveAudience");
const { dispatchPush } = require("../push");

/**
 * Which feed a row belongs in, from the recipient's role.
 *
 * A sub-vendor reads the vendor feed — they are a vendor-side user, and giving
 * them a feed of their own would mean an outlet manager never seeing anything.
 */
const AUDIENCE_BY_ROLE = Object.freeze({
  [ROLES.ADMIN]: NOTIFICATION_AUDIENCE.ADMIN,
  [ROLES.VENDOR]: NOTIFICATION_AUDIENCE.VENDOR,
  [ROLES.SUB_VENDOR]: NOTIFICATION_AUDIENCE.VENDOR,
  [ROLES.CUSTOMER]: NOTIFICATION_AUDIENCE.CUSTOMER,
});

/**
 * Notify a whole audience in one call.
 *
 * `notify()` handles a single recipient and is what domain events use. This is
 * its fan-out counterpart: describe *who* declaratively — a list of users, a
 * role, the owners of some brands, everybody — and it writes one notification
 * row per recipient and pushes to all of their devices.
 *
 * One row per recipient, not one shared row, because read state is per person:
 * a broadcast that one vendor has read and another has not cannot be a single
 * document.
 *
 * Each row is labelled with the audience matching that recipient's role, so a
 * mixed send (vendors and customers together) still lands in the right feed for
 * each of them without the caller splitting it up.
 *
 * `dedupeKeyPrefix` makes a fan-out idempotent per recipient
 * (`<prefix>:<userId>`), so a retried broadcast tops up whoever was missed
 * instead of double-sending to everyone.
 *
 * Email is **off** by default here. A fan-out can be thousands of recipients and
 * SMTP is far slower than a push; bulk mail belongs in a job, not a request.
 *
 * **Never throws for delivery reasons** — but it *does* propagate an invalid or
 * oversized audience, because that is the caller's mistake and they need to see
 * it rather than have it swallowed.
 *
 * @param {object}  params
 * @param {object}  params.target            audience — see resolveAudience
 * @param {string}  params.type              NOTIFICATION_TYPES
 * @param {string}  params.title
 * @param {string}  params.body
 * @param {string} [params.severity]
 * @param {object} [params.meta]             merged into every row and pushed as data
 * @param {string} [params.dedupeKeyPrefix]
 * @param {boolean}[params.push=true]
 * @param {string} [params.imageUrl]
 * @param {string} [params.deepLink]         client route to open on tap
 * @returns {Promise<{recipients:number, created:number, duplicates:number,
 *                    push:object|null}>}
 */
exports.notifyAudience = async ({
  target,
  type,
  title,
  body,
  severity = NOTIFICATION_SEVERITY.INFO,
  meta,
  dedupeKeyPrefix,
  push = true,
  imageUrl,
  deepLink,
}) => {
  // Deliberately outside the try: a bad audience is a caller error (422), not a
  // failed delivery to swallow.
  const { users, total } = await resolveAudience(target);

  if (!total) {
    return { recipients: 0, created: 0, duplicates: 0, push: null };
  }

  const rows = users.map((u) => ({
    userId: u.userId,
    audience: AUDIENCE_BY_ROLE[u.role] || NOTIFICATION_AUDIENCE.VENDOR,
    type,
    severity,
    title,
    body,
    channels: [NOTIFICATION_CHANNELS.IN_APP],
    meta: { ...(meta || {}), ...(deepLink ? { deepLink } : {}) },
    ...(dedupeKeyPrefix ? { dedupeKey: `${dedupeKeyPrefix}:${u.userId}` } : {}),
  }));

  // The rows this call actually wrote. Everything downstream keys off these
  // rather than off the audience, so a retry cannot touch a recipient who was
  // skipped as a duplicate.
  let insertedRows = [];
  let insertError = null;
  try {
    // Unordered so one duplicate dedupeKey does not abandon the rest of the
    // batch — the whole point of retrying a partly-delivered broadcast.
    insertedRows = await Notification.insertMany(rows, { ordered: false });
  } catch (error) {
    // An unordered `insertMany` throws on the first failure but has already
    // written the rest, and hands back the documents that landed.
    insertedRows = Array.isArray(error?.insertedDocs) ? error.insertedDocs : [];
    const onlyDuplicates =
      error?.code === 11000 ||
      (Array.isArray(error?.writeErrors) &&
        error.writeErrors.every((e) => e?.err?.code === 11000 || e?.code === 11000));
    if (!onlyDuplicates) {
      insertError = error?.message;
      console.error(`[notifyAudience] ${type} partially failed:`, error?.message);
    }
  }

  const created = insertedRows.length;
  const duplicates = total - created;

  // Push only to whoever actually got a row on *this* call. Someone skipped as a
  // duplicate has already been notified once, and pushing again is exactly what
  // dedupe exists to prevent.
  //
  // Awaited, unlike in notify(): a broadcast is an explicit admin action whose
  // response should report what was delivered, and it is not sitting inside a
  // payment path. dispatchPush never throws.
  let pushResult = null;
  if (push && created > 0) {
    const pushedTo = [...new Set(insertedRows.map((r) => String(r.userId)))];

    pushResult = await dispatchPush(pushedTo, {
      title,
      body,
      imageUrl,
      data: {
        type,
        ...(deepLink ? { deepLink } : {}),
        ...(meta?.brandId ? { brandId: String(meta.brandId) } : {}),
        ...(meta?.broadcastId ? { broadcastId: String(meta.broadcastId) } : {}),
      },
    });

    if (pushResult.sent > 0) {
      // Scoped to the ids just written. Filtering on `type` and `userId` instead
      // would mark every past notification of this type for those users as
      // pushed, which is a delivery claim that never happened.
      await Notification.updateMany(
        { _id: { $in: insertedRows.map((r) => r._id) } },
        { $addToSet: { channels: NOTIFICATION_CHANNELS.PUSH } },
      );
    }
  }

  return {
    recipients: total,
    created,
    duplicates,
    push: pushResult,
    ...(insertError ? { error: insertError } : {}),
  };
};
