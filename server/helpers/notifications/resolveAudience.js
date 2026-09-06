const mongoose = require("mongoose");
const User = require("../../models/User");
const Brand = require("../../models/Brand");
const Customer = require("../../models/Customer");
const SubBrand = require("../../models/SubBrand");
const { ROLES } = require("../../constants");
const { AUDIENCE_LIMITS } = require("../../constants/notification");
const { throwError } = require("../../utils");
const { getAdminConfig } = require("../settings");

const toObjectIds = (values = []) =>
  values
    .filter(Boolean)
    .map((v) => (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(String(v))));

/**
 * Turn a declarative audience into the set of users to notify.
 *
 * This is what keeps the notification layer role-agnostic. Callers describe *who*
 * — specific users, everyone with a role, the owners of certain brands, every
 * customer — and never assemble user ids themselves. Adding a role later needs no
 * change here beyond it existing in `ROLES`.
 *
 * The targets combine as a **union**: `{ roles: ["CUSTOMER"], userIds: [x] }`
 * reaches every customer plus user x. `filters` then narrow the result.
 *
 * ```js
 * resolveAudience({ userIds: ["..."] })                  // one or more users
 * resolveAudience({ roles: [ROLES.CUSTOMER] })           // a whole role
 * resolveAudience({ brandIds: ["..."] })                 // those brands' owners
 * resolveAudience({ customerIds: ["..."] })              // those customers
 * resolveAudience({ subBrandIds: ["..."] })              // those outlets' users
 * resolveAudience({ all: true })                         // everybody active
 * resolveAudience({ roles: [ROLES.VENDOR], filters: { hasEmail: true } })
 * ```
 *
 * Returns each recipient's role alongside their id, so a caller can label the
 * notification row per recipient without a second query.
 *
 * @returns {Promise<{ userIds: string[], users: Array<{userId: string, role: string}>,
 *                     total: number, truncated: boolean }>}
 */
exports.resolveAudience = async (target = {}) => {
  /**
   * ⚠️ The ceiling is a **setting**, not a constant.
   *
   * `AUDIENCE_LIMITS.MAX_RECIPIENTS_PER_DISPATCH` is now only the fallback,
   * for a settings document written before the field existed. The right
   * number depends on the deployment — how fast the mail provider is, how
   * many FCM batches this process can hold — and hard-coding it meant the
   * day the platform outgrew 5,000 users the only way to reach everyone was
   * a deploy.
   *
   * Read once here rather than inside the role sweep below, which already
   * runs a query per role.
   */
  let maxRecipients = AUDIENCE_LIMITS.MAX_RECIPIENTS_PER_DISPATCH;
  try {
    const adminConfig = await getAdminConfig();
    if (Number.isFinite(adminConfig?.maxRecipientsPerDispatch)) {
      maxRecipients = adminConfig.maxRecipientsPerDispatch;
    }
  } catch (error) {
    /**
     * A settings read that fails must not stop a broadcast that is well
     * inside any sane limit — it falls back to the constant and says so.
     * Failing closed here would make a settings outage look like a
     * notification bug.
     */
    console.warn(
      "[notifications] could not read maxRecipientsPerDispatch, using the default:",
      error?.message,
    );
  }

  const { userIds, roles, brandIds, customerIds, subBrandIds, all, filters = {} } = target;

  const hasAnyTarget =
    userIds?.length ||
    roles?.length ||
    brandIds?.length ||
    customerIds?.length ||
    subBrandIds?.length ||
    all;

  if (!hasAnyTarget) {
    throwError(
      422,
      "An audience is required: pass userIds, roles, brandIds, customerIds, subBrandIds, or all.",
    );
  }

  const collected = new Set();

  if (userIds?.length) {
    toObjectIds(userIds).forEach((id) => collected.add(String(id)));
  }

  // The owning user of each brand — how you reach "these vendors".
  if (brandIds?.length) {
    const brands = await Brand.find({
      _id: { $in: toObjectIds(brandIds) },
      isDeleted: false,
    })
      .select("userId")
      .lean();
    brands.forEach((b) => b.userId && collected.add(String(b.userId)));
  }

  if (customerIds?.length) {
    const customers = await Customer.find({
      _id: { $in: toObjectIds(customerIds) },
      isDeleted: false,
    })
      .select("userId")
      .lean();
    customers.forEach((c) => c.userId && collected.add(String(c.userId)));
  }

  if (subBrandIds?.length) {
    const subBrands = await SubBrand.find({
      _id: { $in: toObjectIds(subBrandIds) },
      isDeleted: false,
    })
      .select("userId")
      .lean();
    subBrands.forEach((s) => s.userId && collected.add(String(s.userId)));
  }

  // Role and all-users targets are queried last, and only for what the filters
  // allow, so a broadcast does not load every user document.
  if (roles?.length || all) {
    const match = { isActive: true, isDeleted: false };
    if (roles?.length) {
      const invalid = roles.filter((r) => !Object.values(ROLES).includes(r));
      if (invalid.length) {
        throwError(422, `Unknown role(s): ${invalid.join(", ")}`);
      }
      match.role = { $in: roles };
    }
    if (filters.hasEmail) match.email = { $nin: [null, ""] };

    // One more than the cap, so truncation can be reported rather than guessed.
    const bulk = await User.find(match)
      .select("_id")
      .limit(maxRecipients + 1)
      .lean();
    bulk.forEach((u) => collected.add(String(u._id)));
  }

  // Every candidate is re-read as a user, whether it came from a role sweep or
  // was named explicitly: a deleted or deactivated account must not be notified
  // just because someone passed its id. The role comes back with it so the
  // caller can label rows without another query.
  let users = [];
  if (collected.size) {
    const alive = await User.find({
      _id: { $in: toObjectIds([...collected]) },
      isActive: true,
      isDeleted: false,
      ...(filters.hasEmail ? { email: { $nin: [null, ""] } } : {}),
    })
      /**
       * ⚠️ `notificationPreferences` comes back with the role because
       * `notifyAudience` bypasses `notify()` entirely — it writes rows with
       * `insertMany` and pushes in one bulk call. Without this the broadcast
       * path would be the one place a person's own toggles did not apply, and
       * that is the path that reaches everybody at once.
       *
       * Raw, not normalised: `channelPreferences.js` owns "absent means on".
       */
      .select("_id role notificationPreferences")
      .lean();
    users = alive.map((u) => ({
      userId: String(u._id),
      role: u.role,
      notificationPreferences: u.notificationPreferences || null,
    }));
  }

  const total = users.length;
  const truncated = total > maxRecipients;

  if (truncated) {
    /**
     * Never silently drop recipients — a caller that thinks it reached everyone
     * and did not is worse than an error.
     *
     * ⚠️ **"more than N", not an exact count.** The role sweep above fetches
     * only `maxRecipients + 1` rows precisely so it never has to count a huge
     * audience, so `total` here is the cap plus one, not the real size. Printing
     * it as an exact figure told an admin who set the cap to 1 that the audience
     * was 2 — raise it to 2 and it fails again, now claiming 3. The honest
     * statement is that it is over the line, because that is all this knows.
     */
    throwError(
      422,
      `This audience resolves to more than ${maxRecipients} recipients, which is the limit for a single dispatch. Narrow the target, raise admin.notification.maxRecipientsPerDispatch in settings, or send it as a background job.`,
    );
  }

  return { userIds: users.map((u) => u.userId), users, total, truncated: false };
};
