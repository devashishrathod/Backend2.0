/**
 * ⚠️ `notifyAdmins`, not `notify({ audience: ADMIN })`.
 *
 * The latter addresses nobody — it builds its destination from `brandId` /
 * `customerId` / `userId`, and this notice passes none — so the row appeared in
 * the admin feed and no email or push was ever sent. On a CRITICAL alert whose
 * subject is that **roughly every second voucher claim is failing right now**,
 * in-app-only is not a delivery.
 */
const { notifyAdmins } = require("./notifyAdmins");
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_SEVERITY,
} = require("../../constants/notification");
const { deepLink, adminUrl, ADMIN_PATHS } = require("./panelLinks");

/**
 * To the **admin**: a shadow index was found and removed — so something else is
 * writing to this database.
 *
 * ### ⚠️ The alert is not about the index
 *
 * By the time this is sent the index is already gone and the platform is working
 * again. What the message is actually reporting is **what put it there**.
 *
 * Nothing in this build creates a blanket unique index; commit `3494bb8`
 * replaced the last one with a named partial. So a shadow appearing means
 * another process wrote to this cluster — almost certainly an older build of
 * this same service, whose schema still carries `unique: true` on that path and
 * whose Mongoose `autoIndex` rebuilds it on every restart.
 *
 * ⚠️ **The timestamp is the lead.** The sweep runs hourly, so a reap means that
 * writer restarted inside the last hour. Correlating that against the deploy and
 * restart history of every service pointed at this cluster is the one reliable
 * way to identify it — `$currentOp`, which would name it outright, is not
 * permitted on Atlas shared tiers.
 *
 * ### Why CRITICAL for something already fixed
 *
 * Because of what the index does while it is there, and because it will be back.
 * A blanket unique on a nullable path rejects the **second** row with no value,
 * and every voucher claim is created before its invoice exists — so between the
 * writer's restart and the next sweep, roughly half of all claims fail, with a
 * duplicate-key error naming a field the customer never touched. Nothing else in
 * the system reports that as a fault: to every other layer it looks like a
 * validation error.
 *
 * ### Not deduped by day
 *
 * Deliberately, unlike `VENDOR_DEBT_AGED`. Every reap is a **separate restart of
 * the other writer**, and the count and the times are the evidence. Collapsing
 * them into one message a day would throw away the only signal that says how
 * often it is happening.
 */
exports.notifyAdminShadowIndexReaped = async ({ reaped = [], blocked = [] }) => {
  if (!reaped.length && !blocked.length) return null;

  const at = new Date();
  const list = reaped
    .map((r) => `${r.collection}.${r.index} (replaced by ${r.replacedBy})`)
    .join(", ");

  const stuck = blocked
    .filter((b) => b.reason !== "DRY_RUN")
    .map((b) => `${b.collection}.${b.index}: ${b.reason}`);

  return notifyAdmins({
    severity: NOTIFICATION_SEVERITY.CRITICAL,
    type: NOTIFICATION_TYPES.SHADOW_INDEX_REAPED,
    title: stuck.length
      ? `Shadow index could NOT be removed — claims are failing now`
      : `Another process is writing to this database`,
    body:
      (reaped.length
        ? `Removed ${reaped.length} blanket unique index(es): ${list}. `
        : "") +
      (stuck.length
        ? `⚠️ ${stuck.length} could not be dropped — ${stuck.join("; ")}. ` +
          `While they are there, roughly every second voucher claim will fail ` +
          `with a duplicate-key error. `
        : "") +
      `Nothing in this build creates these, so another process wrote to this ` +
      `cluster — most likely an older build of this service still running and ` +
      `pointed at the same database. It restarted within the last hour: check ` +
      `the deploy and restart history of everything connected. ` +
      `Run scripts/findIndexWriters.js, and narrow Atlas Network Access to the ` +
      `addresses this deployment actually uses — that locks it out for good.`,
    meta: {
      reaped,
      blocked: stuck,
      detectedAt: at,
    },
    deepLink: deepLink(ADMIN_PATHS.SETTLEMENTS),
    /**
     * ⚠️ Keyed on the **minute**, not the day.
     *
     * Enough to collapse two instances reaping the same thing in the same sweep,
     * and not enough to hide a second restart an hour later — which is exactly
     * the fact somebody needs.
     */
    dedupeKey: `SHADOW_INDEX_REAPED:${at.toISOString().slice(0, 16)}`,
    mail: {
      lines: [
        ["Removed", String(reaped.length)],
        ["Could not remove", String(stuck.length)],
        ["Indexes", list || "-"],
        ["Detected at", at.toISOString()],
      ],
      ctaLabel: "Open admin panel",
      ctaUrl: adminUrl(ADMIN_PATHS.SETTLEMENTS),
    },
  });
};
