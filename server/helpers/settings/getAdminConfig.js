const { getSetting } = require("./getSetting");
const {
  ADMIN_NOTIFICATION_DEFAULTS,
} = require("../../constants/notification");

/**
 * The admin audience's outbound channel toggles.
 *
 * ### ⚠️ Why this exists at all
 *
 * `getNotificationConfig(audience)` in `helpers/notifications/notify.js` used to
 * be *"customer? read the customer block; otherwise read the vendor block"* —
 * and admin fell into *otherwise*. So `Setting.vendor.subscription
 * .isEmailNotificationEnabled` governed the admin feed as well: an admin
 * switching off vendor renewal reminders also switched off
 * `SETTLEMENT_LEDGER_DRIFT`, `REFUND_FAILED` and every other alert that exists
 * to reach a person when money has gone wrong.
 *
 * Nothing reported it. The in-app rows kept appearing, so from the panel it
 * looked identical to a quiet week.
 *
 * ⚠️ The **same shape** is why the customer block was split out earlier — see
 * the note in `models/Setting.js`. Two audiences had been separated and the
 * third was left sharing; this finishes it.
 *
 * `??` and not `||`, so an explicit `false` from the database is honoured rather
 * than falling through to the default.
 */
exports.getAdminConfig = async () => {
  const setting = await getSetting();
  const s = setting?.admin?.notification || {};
  const d = ADMIN_NOTIFICATION_DEFAULTS;

  return {
    isEmailNotificationEnabled:
      s.isEmailNotificationEnabled ?? d.isEmailNotificationEnabled,
    isPushNotificationEnabled:
      s.isPushNotificationEnabled ?? d.isPushNotificationEnabled,
    isWhatsAppNotificationEnabled:
      s.isWhatsAppNotificationEnabled ?? d.isWhatsAppNotificationEnabled,
  };
};
