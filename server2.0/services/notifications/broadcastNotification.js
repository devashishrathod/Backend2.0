const mongoose = require("mongoose");
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_SEVERITY,
} = require("../../constants/notification");
const { notifyAudience, resolveAudience } = require("../../helpers/notifications");

/**
 * Send an admin-composed notification to a chosen audience.
 *
 * The generic entry point for everything that is not a domain event: a
 * maintenance notice to every vendor, an offer to all customers, a message to
 * three specific users. Domain events (a subscription activating, a limit being
 * hit) go through their own helpers and never come here.
 *
 * Targeting is declarative and role-agnostic — `roles`, `userIds`, `brandIds`,
 * `customerIds`, `subBrandIds`, `all` — so a role added to the platform later is
 * addressable through this same endpoint with no change here.
 *
 * `dryRun` resolves the audience and reports its size **without sending**. Worth
 * using before any broadcast: "all customers" is not a number you want to
 * discover after the fact.
 *
 * Every send carries a `broadcastId` in `meta`, so the rows from one broadcast
 * can be found together afterwards, and a retry of the *same* broadcastId is
 * idempotent per recipient rather than a second copy for everyone.
 */
exports.broadcastNotification = async (actor, payload = {}) => {
  const {
    title,
    body,
    target,
    severity = NOTIFICATION_SEVERITY.INFO,
    type = NOTIFICATION_TYPES.ANNOUNCEMENT,
    push = true,
    deepLink,
    imageUrl,
    meta,
    dryRun = false,
    broadcastId,
  } = payload;

  // A caller-supplied id makes a retry idempotent; otherwise each broadcast is
  // its own event.
  const id = broadcastId || String(new mongoose.Types.ObjectId());

  if (dryRun) {
    const { users, total } = await resolveAudience(target);

    // Grouped by role, because "12,431 recipients" tells an admin much less than
    // seeing that 12,400 of them are customers.
    const byRole = users.reduce((acc, u) => {
      acc[u.role] = (acc[u.role] || 0) + 1;
      return acc;
    }, {});

    return {
      dryRun: true,
      sent: false,
      recipients: total,
      byRole,
      broadcastId: id,
      message: `This audience resolves to ${total} recipient(s). Re-send with dryRun false to deliver.`,
    };
  }

  const result = await notifyAudience({
    target,
    type,
    severity,
    title,
    body,
    push,
    deepLink,
    imageUrl,
    meta: {
      ...(meta || {}),
      broadcastId: id,
      // Who sent it — a broadcast is a privileged action and should be
      // attributable after the fact.
      sentBy: String(actor.userId),
    },
    // Per-recipient dedupe, so re-sending the same broadcastId tops up whoever
    // was missed instead of double-notifying everyone who already got it.
    dedupeKeyPrefix: `BROADCAST:${id}`,
  });

  return {
    dryRun: false,
    sent: true,
    broadcastId: id,
    recipients: result.recipients,
    notificationsCreated: result.created,
    // Recipients who already had this exact broadcast — a retry, not a failure.
    alreadyNotified: result.duplicates,
    push: result.push
      ? {
          devicesTargeted: result.push.devices,
          delivered: result.push.sent,
          failed: result.push.failed,
          usersReached: result.push.usersReached ?? 0,
          deactivatedTokens: result.push.deactivated ?? 0,
          ...(result.push.skipped ? { skipped: true, reason: result.push.reason } : {}),
        }
      : { skipped: true, reason: "Push was not requested" },
  };
};
