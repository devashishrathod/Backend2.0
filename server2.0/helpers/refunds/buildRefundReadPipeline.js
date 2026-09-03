const mongoose = require("mongoose");
const { ROLES } = require("../../constants");
const { buildAccessScopeFilter } = require("../transactions");
const {
  REFUND_REQUEST_STATUS,
  REFUND_OPEN_STATUSES,
  REFUND_CUSTOMER_LABEL,
} = require("../../constants/refund");

const asId = (value) =>
  value ? new mongoose.Types.ObjectId(String(value)) : undefined;

/**
 * What a refund listing accepts, narrowed to what the caller may see.
 *
 * The scope and the caller's filters are **intersected**, never overlaid — the
 * same rule the money listings follow. A vendor asking `?brandId=<someone else>`
 * gets nothing rather than their own rows: overlaying is safe but silent, and a
 * filter that looks like it worked is how somebody builds a report on a filter
 * that never applied.
 */
exports.buildRefundListFilter = (actor, query = {}) => {
  const filter = { isDeleted: false };

  if (query.status) filter.status = query.status;
  if (query.claimCode) {
    filter.claimCode = String(query.claimCode).trim().toUpperCase();
  }
  if (query.brandId) filter.brandId = asId(query.brandId);
  if (query.outletId) filter.subBrandId = asId(query.outletId);

  /**
   * `?open=true` is the worklist. Keyed on the denormalised flag rather than a
   * status list, because Mongo cannot express "in one of these six" as anything
   * an index will use here.
   */
  if (query.open !== undefined) filter.isOpen = Boolean(query.open);

  if (query.from || query.to) {
    filter.createdAt = {
      ...(query.from ? { $gte: new Date(query.from) } : {}),
      // Inclusive of the whole end day. A report "up to the 31st" that stops at
      // midnight silently drops a day.
      ...(query.to
        ? { $lte: new Date(new Date(query.to).setHours(23, 59, 59, 999)) }
        : {}),
    };
  }

  const scope = buildAccessScopeFilter(actor);

  const conflicts = Object.keys(scope).some(
    (key) =>
      filter[key] !== undefined && String(filter[key]) !== String(scope[key]),
  );
  // A filter that matches nothing, rather than one that quietly matches the
  // wrong thing.
  if (conflicts) return { _id: null };

  return { ...filter, ...scope };
};

/**
 * What each audience reads off a refund request.
 *
 * ### The field that must never reach a vendor
 *
 * `split` carries `platformPromoReversal` and `gatewayFeeAbsorbed` — our promo
 * share and the MDR we swallow. Both are commercial disclosures, and both sit on
 * the same sub-document as `vendorClawback`, which the vendor genuinely needs to
 * see. That is exactly why the decision is made once, here, rather than
 * remembered at each call site.
 *
 * ### And the notes
 *
 * `vendorNote`, `adminNote` and `overrideReason` are written by staff **for
 * staff**. A vendor sees their own note; nobody sees the admin's. The customer
 * sees neither — they get `statusLabel`, the same sentence the timeline uses.
 * *"Customer collected the order in full"* is not a line to render to the
 * customer it is about, however true it is.
 */
exports.refundProjection = (role) => {
  const base = {
    _id: 1,
    createdAt: 1,
    updatedAt: 1,
    status: 1,
    isOpen: 1,
    claimId: 1,
    transactionId: 1,
    claimCode: 1,
    brandId: 1,
    subBrandId: 1,
    requestedAmount: 1,
    approvedAmount: 1,
    reason: 1,
    method: 1,
    completedAt: 1,
    failedAt: 1,
  };

  if (role === ROLES.ADMIN) {
    return {
      ...base,
      customerId: 1,
      reasonNote: 1,
      // The whole block — reconciliation needs what it cost us.
      split: 1,
      vendorDecisionBy: 1,
      vendorDecisionAt: 1,
      vendorNote: 1,
      vendorRespondBy: 1,
      remindersSent: 1,
      adminDecisionBy: 1,
      adminDecisionAt: 1,
      adminNote: 1,
      isOverride: 1,
      overrideReason: 1,
      razorpayRefundId: 1,
      utr: 1,
      speed: 1,
      initiatedAt: 1,
      failureReason: 1,
      attemptCount: 1,
      settlementId: 1,
    };
  }

  if (role === ROLES.CUSTOMER) {
    return {
      ...base,
      customerId: 1,
      reasonNote: 1,
      /**
       * The bank reference, and the one field support is actually asked for —
       * the customer quotes it to their own bank when the money has not landed.
       */
      utr: 1,
      // What they will get, and nothing about where it comes from.
      "split.totalRefund": 1,
      "split.isFullRefund": 1,
    };
  }

  // VENDOR and SUB_VENDOR.
  return {
    ...base,
    // Why the customer says it went wrong — the whole basis of their decision.
    reasonNote: 1,
    vendorDecisionAt: 1,
    vendorNote: 1,
    vendorRespondBy: 1,
    // What it costs them, and only that.
    "split.vendorClawback": 1,
    "split.vendorPromoReversal": 1,
    "split.isFullRefund": 1,
    settlementId: 1,
  };
};

/**
 * Dress a stored request for the audience reading it.
 *
 * `statusLabel` rides along on every shape so one response serves the app and
 * the panel. `VENDOR_TIMEOUT` in particular never reaches the customer as
 * itself — telling them the outlet ignored their request starts a fight the
 * platform then has to referee, and it is not something they can act on.
 */
exports.presentRefund = (request, role) => {
  if (!request) return request;

  return {
    ...request,
    statusLabel: REFUND_CUSTOMER_LABEL[request.status] || request.status,
    isOpen: REFUND_OPEN_STATUSES.includes(request.status),
    /**
     * Whether this audience can still act, stated rather than inferred. A panel
     * that works it out from the status will get it wrong the first time a new
     * state is added.
     */
    canDecide:
      (role === ROLES.VENDOR || role === ROLES.SUB_VENDOR) &&
      request.status === REFUND_REQUEST_STATUS.REQUESTED,
    canWithdraw:
      role === ROLES.CUSTOMER &&
      [
        REFUND_REQUEST_STATUS.REQUESTED,
        REFUND_REQUEST_STATUS.VENDOR_APPROVED,
        REFUND_REQUEST_STATUS.VENDOR_TIMEOUT,
      ].includes(request.status),
  };
};
