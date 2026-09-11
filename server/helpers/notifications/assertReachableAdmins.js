const User = require("../../models/User");
const { ROLES } = require("../../constants");
const {
  NOTIFICATION_AUDIENCE,
  NOTIFICATION_TYPES,
  NOTIFICATION_SEVERITY,
} = require("../../constants/notification");
const { resolveAudienceChannels } = require("./audienceChannels");
const { notifyAdmins } = require("./notifyAdmins");

/**
 * ---------------- can the admins still be told? ----------------
 *
 * `SETTLEMENT_LEDGER_DRIFT`, `REFUND_FAILED` and `SHADOW_INDEX_REAPED` are on
 * `ALWAYS_DELIVER_TYPES` because their silence costs money. They now also need a
 * **verified** address, because an unconfirmed one is not known to belong to the
 * person it is aimed at.
 *
 * ⚠️ That is a safe rule for every role except this one, and the reason is a
 * setting rather than anything about identity:
 * `ADMIN_NOTIFICATION_DEFAULTS.isWhatsAppNotificationEnabled` is **`false`**, so
 * WhatsApp is shut for the admin audience platform-wide. A vendor or customer
 * whose email is unverified is still reached on WhatsApp — their login identity,
 * and therefore always verified. An admin is not. Email is their only outbound
 * channel, and if it is unverified they have none.
 *
 * ### Why this runs at boot rather than being a one-off check
 *
 * `CLAUDE.md` spends a section on the shape of failure this belongs to: *"A
 * settlement fails by **not happening**"*. An admin who cannot be reached
 * produces no error — the in-app row is written, the send is skipped, and
 * everything looks normal. A list produced once during a migration would be
 * correct that day and stale the moment somebody adds an admin.
 *
 * Reports and never acts. Marking an address verified without an OTP is the one
 * thing the whole feature forbids, and doing it here — for the accounts with the
 * most power — would be the worst possible place to make an exception.
 *
 * Never throws: a boot check that can fail a deploy over a warning is worse than
 * the warning.
 */
const assertReachableAdmins = async () => {
  try {
    const { channels } = await resolveAudienceChannels(
      NOTIFICATION_AUDIENCE.ADMIN,
    );

    const admins = await User.find({ role: ROLES.ADMIN, isDeleted: false })
      .select("name email isEmailVerified isWhatsappVerified")
      .lean();

    if (!admins.length) return { total: 0, unreachable: [] };

    /**
     * Unreachable = **every** outbound channel shut for them.
     *
     * Checked per admin against the live platform switches rather than assumed,
     * because the WhatsApp one is settable from the admin panel: the day somebody
     * turns it on, an admin with a verified WhatsApp number stops being a
     * problem and this must stop saying they are.
     */
    const unreachable = admins.filter((admin) => {
      const byEmail = channels.email && admin.isEmailVerified === true;
      const byWhatsapp = channels.whatsapp && admin.isWhatsappVerified === true;
      return !byEmail && !byWhatsapp;
    });

    if (!unreachable.length) return { total: admins.length, unreachable: [] };

    const names = unreachable
      .map((a) => a.name || a.email || String(a._id))
      .join(", ");

    console.error(
      `🔴 [notify] ${unreachable.length} of ${admins.length} admin(s) have no ` +
        `verified outbound channel — money alerts will reach them in-app and on ` +
        `push only: ${names}. Each of them should sign in and run ` +
        `POST /auth/email/verify once.`,
    );

    /**
     * ⚠️ Told to the admins who **can** still be reached.
     *
     * `notifyAdmins` writes the in-app row for everybody regardless, so the
     * people it is about see it the next time they sign in — which is the only
     * channel that is certainly working for them.
     */
    await notifyAdmins({
      type: NOTIFICATION_TYPES.SHADOW_INDEX_REAPED,
      severity: NOTIFICATION_SEVERITY.CRITICAL,
      title: "Some admins cannot receive money alerts",
      body:
        `${unreachable.length} admin account(s) have no verified email, and ` +
        `WhatsApp is off for the admin audience — so settlement and refund ` +
        `alerts reach them in-app only. Affected: ${names}.`,
      // One notice per boot per day, not one per restart.
      dedupeKey: `admin-unreachable:${new Date().toISOString().slice(0, 10)}`,
    }).catch(() => {});

    return { total: admins.length, unreachable: unreachable.map((a) => a._id) };
  } catch (error) {
    console.error("[notify] admin reachability check failed:", error?.message);
    return null;
  }
};

module.exports = { assertReachableAdmins };
