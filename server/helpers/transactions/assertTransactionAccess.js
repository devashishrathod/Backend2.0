const { ROLES } = require("../../constants");
const { throwError } = require("../../utils");
const { resolveCustomerId } = require("../customers");

/**
 * May this actor see this transaction, and how much of it?
 *
 * Two questions in one, deliberately. "Can they open it" and "what do they get
 * to read" have the same answer source — who they are relative to the row — and
 * splitting them is how a listing ends up leaking a field the detail endpoint
 * carefully hides.
 *
 * ### The three answers
 *
 * | Actor | Sees | Because |
 * |---|---|---|
 * | The customer who paid | their own money | it is their payment |
 * | The brand it was paid to | what they will be settled | it is their sale |
 * | An admin | everything | reconciliation needs everything |
 *
 * ### What a vendor must never see
 *
 * The gateway fee, the platform's share of a promo, the customer's contact
 * details. A vendor knowing our MDR is a commercial disclosure; a vendor
 * knowing the customer's phone number is a privacy one. Both are on the same
 * document, which is exactly why the projection is decided here rather than
 * remembered at each call site.
 *
 * @param {object} actor        the request
 * @param {object} transaction  the row being opened
 * @returns {{ role, scope, canSeePlatformCosts, canSeeCustomerContact }}
 * @throws {CustomError} 403 when the actor has no claim on this row
 */
exports.assertTransactionAccess = (actor = {}, transaction) => {
  if (!transaction) throwError(404, "Payment not found.");

  const role = actor.role;

  // ---------------- admin ----------------
  if (role === ROLES.ADMIN) {
    return {
      role: ROLES.ADMIN,
      scope: "ALL",
      canSeePlatformCosts: true,
      canSeeCustomerContact: true,
    };
  }

  // ---------------- the customer who paid ----------------
  const customerId = resolveCustomerId(actor);
  if (customerId && String(transaction.customerId) === String(customerId)) {
    return {
      role: ROLES.CUSTOMER,
      scope: "OWN",
      // Their own money, but not our margin — what Razorpay charged us is not
      // part of what they bought.
      canSeePlatformCosts: false,
      canSeeCustomerContact: true,
    };
  }

  // ---------------- the brand it was paid to ----------------
  //
  // A sub-vendor reaches this through the parent `brandId` their token now
  // carries. Narrowing to their own outlet is the caller's job — a gate decides
  // whether, not how much.
  const isBrandSide = role === ROLES.VENDOR || role === ROLES.SUB_VENDOR;
  if (
    isBrandSide &&
    actor.brandId &&
    String(transaction.brandId) === String(actor.brandId)
  ) {
    // An outlet may only open what happened at that outlet.
    if (
      role === ROLES.SUB_VENDOR &&
      actor.subBrandId &&
      transaction.subBrandId &&
      String(transaction.subBrandId) !== String(actor.subBrandId)
    ) {
      throwError(403, "This payment was not taken at your outlet.");
    }

    return {
      role,
      scope: "BRAND",
      // Our MDR and our share of a campaign are not the vendor's business.
      canSeePlatformCosts: false,
      // Nor is the customer's phone number.
      canSeeCustomerContact: false,
    };
  }

  throwError(403, "You are not authorized to view this payment.");
};

/**
 * The same question about a claim.
 *
 * A separate function rather than a shared one taking a discriminator: the two
 * documents name their owner differently, and a single function that has to
 * guess which field to read is one rename away from letting the wrong person in.
 */
exports.assertClaimAccess = (actor = {}, claim) => {
  if (!claim) throwError(404, "Claim not found.");

  const role = actor.role;

  if (role === ROLES.ADMIN) {
    return {
      role: ROLES.ADMIN,
      scope: "ALL",
      canSeePlatformCosts: true,
      canSeeCustomerContact: true,
    };
  }

  const customerId = resolveCustomerId(actor);
  if (customerId && String(claim.customerId) === String(customerId)) {
    return {
      role: ROLES.CUSTOMER,
      scope: "OWN",
      canSeePlatformCosts: false,
      canSeeCustomerContact: true,
    };
  }

  const isBrandSide = role === ROLES.VENDOR || role === ROLES.SUB_VENDOR;
  if (
    isBrandSide &&
    actor.brandId &&
    String(claim.brandId) === String(actor.brandId)
  ) {
    if (
      role === ROLES.SUB_VENDOR &&
      actor.subBrandId &&
      claim.subBrandId &&
      String(claim.subBrandId) !== String(actor.subBrandId)
    ) {
      throwError(403, "This claim was not made at your outlet.");
    }

    return {
      role,
      scope: "BRAND",
      canSeePlatformCosts: false,
      canSeeCustomerContact: false,
    };
  }

  throwError(403, "You are not authorized to view this claim.");
};

/**
 * The filter that scopes a **listing** to what this actor may see.
 *
 * Derived from the same rules as the single-row check, so a list can never
 * surface a row the detail endpoint would refuse to open. Written as a filter
 * rather than a post-filter on purpose: filtering after the query means the
 * pagination count is wrong, and a page of ten can come back with three rows.
 *
 * @throws {CustomError} 403 when the actor has no listing at all
 */
exports.buildAccessScopeFilter = (actor = {}) => {
  const role = actor.role;

  if (role === ROLES.ADMIN) return {};

  const customerId = resolveCustomerId(actor);
  if (role === ROLES.CUSTOMER) {
    if (!customerId) throwError(403, "Please log in to see your payments.");
    return { customerId };
  }

  if (role === ROLES.VENDOR) {
    if (!actor.brandId) throwError(403, "No brand is linked to this account.");
    return { brandId: actor.brandId };
  }

  if (role === ROLES.SUB_VENDOR) {
    if (!actor.brandId) throwError(403, "No brand is linked to this account.");
    // Scoped to the outlet, not the whole brand — an outlet manager sees their
    // own counter.
    return actor.subBrandId
      ? { brandId: actor.brandId, subBrandId: actor.subBrandId }
      : { brandId: actor.brandId };
  }

  throwError(403, "You are not authorized to view payments.");
};
