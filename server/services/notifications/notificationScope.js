const mongoose = require("mongoose");
const { throwError } = require("../../utils");
const { ROLES } = require("../../constants");
const { NOTIFICATION_AUDIENCE } = require("../../constants/notification");
const { resolveActorBrand } = require("../../helpers/brands");
const { resolveCustomerId } = require("../../helpers/customers");

/**
 * Who is allowed to see which notifications — decided **once**.
 *
 * ### Why this is its own module
 *
 * The list and the mark-read both need the same answer, and they each built it
 * themselves. Two copies of a scope rule is the shape this codebase keeps
 * warning about: the day a customer branch is added to one and not the other,
 * `mark-read` marks rows the reader was never allowed to see, and nothing fails.
 *
 * The list projects and the mark-read updates, but the **filter** is one
 * decision, so it lives in one place — the same reason `/refunds`,
 * `/settlements` and `/voucher-claims` derive scope from the token rather than
 * splitting into per-role endpoints.
 *
 * @param {object} actor  the request — `role`, `userId`, `brandId`, `customerId`
 * @param {object} query  may carry `brandId` (admin only, see below)
 * @returns {Promise<object>} a Mongo filter, always including `isDeleted: false`
 */
exports.buildNotificationScope = async (actor, query = {}) => {
  const filter = { isDeleted: false };

  /**
   * ⚠️ The customer branch is **first**, and it ignores `query.brandId`
   * entirely.
   *
   * Ordering is the guard. If this fell through to the brand branch, a customer
   * who passed any `brandId` would be asking `resolveActorBrand` to hand them a
   * brand — and the only thing standing between them and a vendor's feed would
   * be that helper's ownership check. Scope must narrow by role before any
   * caller-supplied value is read, never after.
   */
  if (actor.role === ROLES.CUSTOMER) {
    const customerId = resolveCustomerId(actor);
    if (!customerId) throwError(403, "Only a customer can read this feed.");

    filter.audience = NOTIFICATION_AUDIENCE.CUSTOMER;
    filter.customerId = new mongoose.Types.ObjectId(String(customerId));
    return filter;
  }

  /**
   * ⚠️ An outlet manager is refused, deliberately, and this is not an oversight.
   *
   * Before the gate on these routes was widened to `verifyJwtToken`, a
   * `SUB_VENDOR` could not reach them at all — so refusing keeps today's
   * behaviour exactly rather than quietly inventing a new one.
   *
   * It cannot simply fall through either: `resolveActorBrand` compares the
   * brand's `userId` against the caller's, and an outlet manager is not the
   * brand owner, so they would get a `403` reading *"this brand is not yours"* —
   * true of the mechanism, confusing to the person, and about a brand they do
   * legitimately work for.
   *
   * ⚠️ It is also not obviously safe to *grant*: a brand's feed carries
   * settlement amounts, payout failures and vendor-debt notices — the owner's
   * business, not one counter's. Opening it needs a product decision and a
   * brand-resolution path for outlets that does not exist yet.
   */
  if (actor.role === ROLES.SUB_VENDOR) {
    throwError(
      403,
      "Outlet accounts do not have a notification feed yet. Ask the brand owner to check theirs.",
    );
  }

  // An admin with no `brandId` reads the admin-audience feed; with one, they
  // read that brand's, which is what makes support possible.
  const isAdminFeed = actor.role === ROLES.ADMIN && !query.brandId;
  if (isAdminFeed) {
    filter.audience = NOTIFICATION_AUDIENCE.ADMIN;
    return filter;
  }

  const brand = await resolveActorBrand(actor, query.brandId);
  filter.brandId = new mongoose.Types.ObjectId(String(brand._id));
  return filter;
};

/**
 * The fields a given role may see on a notification row.
 *
 * ⚠️ A **whitelist**, not a delete-list. `meta` is `Mixed`, so it can hold
 * whatever the notice that wrote it decided to attach — a settlement id, an
 * invoice number, another outlet's name. Sending the row minus a few known keys
 * means every notice added later leaks by default; sending only named keys means
 * a new one is invisible until somebody deliberately exposes it.
 */
exports.notificationProjection = (actor) => {
  const base = {
    type: 1,
    severity: 1,
    title: 1,
    body: 1,
    isRead: 1,
    readAt: 1,
    createdAt: 1,
  };

  if (actor.role === ROLES.CUSTOMER) {
    return {
      ...base,
      /**
       * Only the handful of ids the inbox needs to deep-link a row, named one by
       * one. Without these the notification is a dead end — the customer reads
       * "your refund was approved" and has nothing to tap.
       */
      "meta.claimId": 1,
      "meta.claimCode": 1,
      "meta.refundRequestId": 1,
      "meta.transactionId": 1,
      "meta.brandId": 1,
    };
  }

  return {
    ...base,
    channels: 1,
    meta: 1,
    // Delivery diagnostics are useful to an admin and noise to a vendor.
    ...(actor.role === ROLES.ADMIN
      ? { emailSentAt: 1, emailError: 1, dedupeKey: 1, brandId: 1 }
      : {}),
  };
};
