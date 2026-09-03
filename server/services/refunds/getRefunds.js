const RefundRequest = require("../../models/RefundRequest");
const VoucherClaim = require("../../models/VoucherClaim");
const { pagination, throwError } = require("../../utils");
const { ROLES } = require("../../constants");
const {
  buildRefundListFilter,
  refundProjection,
  presentRefund,
} = require("../../helpers/refunds");
const {
  pickByProjection,
  claimRecordProjection,
} = require("../../helpers/transactions");
const { resolveCustomerId } = require("../../helpers/customers");
const { buildClaimTimeline } = require("../../helpers/voucherClaims");

/**
 * Refund requests, scoped to whoever is asking.
 *
 * **One endpoint, three shapes**, like every other money listing here. A
 * customer sees their own, a brand sees theirs, an admin sees everything — and
 * each gets a different projection decided in one place rather than by three
 * services that would drift.
 *
 * Sorted **oldest first** when the caller asks for the open worklist, newest
 * first otherwise. The oldest open request is the one closest to timing out and
 * the one a customer has been waiting longest for; the newest is what somebody
 * scanning a history is looking for.
 */
exports.getRefunds = async (actor, query = {}) => {
  const filter = buildRefundListFilter(actor, query);
  const projection = refundProjection(actor.role);

  const wantsWorklist = query.open === true || query.open === "true";

  const pipeline = [
    { $match: filter },
    { $sort: wantsWorklist ? { createdAt: 1 } : { createdAt: -1 } },
    { $project: projection },
  ];

  const result = await pagination(
    RefundRequest,
    pipeline,
    query.page || 1,
    query.limit || 20,
    "refund",
    // A customer who has never asked for a refund has an empty list, not a
    // missing one. 404 here makes a perfectly correct answer look like a fault.
    { allowEmpty: true },
  );

  return {
    ...result,
    data: result.data.map((row) => presentRefund(row, actor.role)),
  };
};

/**
 * One refund request, with the claim behind it and the story so far.
 *
 * ### Read whole, checked, then narrowed
 *
 * Ownership lives in `customerId` and `brandId`, and the vendor projection
 * omits the first of those. Projecting before the access check would mean asking
 * *"is this yours?"* of a document that no longer says whose it is — so the row
 * is read in full, checked, and only then narrowed through `pickByProjection`,
 * which is a whitelist and therefore fails closed.
 */
exports.getRefundDetail = async (actor, requestId) => {
  const request = await RefundRequest.findOne({
    _id: requestId,
    isDeleted: false,
  }).lean();

  if (!request) throwError(404, "Refund request not found.");

  const access = assertRefundAccess(actor, request);

  const [claimDoc, timeline] = await Promise.all([
    VoucherClaim.findById(request.claimId).lean(),
    /**
     * The claim's timeline, not a separate refund one.
     *
     * A refund is something that happened **to a claim**, and the claim's story
     * is where all three audiences go to ask what happened. A second timeline
     * would mean a join to answer that, and two orderings to keep in step.
     */
    buildClaimTimeline({ claimId: request.claimId, role: access.role }),
  ]);

  return {
    refund: presentRefund(
      pickByProjection(request, refundProjection(access.role)),
      access.role,
    ),
    claim: claimDoc
      ? pickByProjection(claimDoc, claimRecordProjection(access.role))
      : null,
    timeline,
    viewer: { role: access.role, scope: access.scope },
  };
};

/**
 * May this actor open this refund?
 *
 * Deliberately not `assertClaimAccess`: a refund names its owner on its own
 * document, and routing through the claim would make the answer depend on a
 * second lookup that could be missing. The rules are the same ones.
 */
const assertRefundAccess = (actor = {}, request) => {
  if (actor.role === ROLES.ADMIN) return { role: ROLES.ADMIN, scope: "ALL" };

  const customerId = resolveCustomerId(actor);
  if (customerId && String(request.customerId) === String(customerId)) {
    return { role: ROLES.CUSTOMER, scope: "OWN" };
  }

  const isBrandSide =
    actor.role === ROLES.VENDOR || actor.role === ROLES.SUB_VENDOR;

  if (
    isBrandSide &&
    actor.brandId &&
    String(request.brandId) === String(actor.brandId)
  ) {
    // An outlet manager sees their own counter, same as everywhere else.
    if (
      actor.role === ROLES.SUB_VENDOR &&
      actor.subBrandId &&
      request.subBrandId &&
      String(request.subBrandId) !== String(actor.subBrandId)
    ) {
      throwError(403, "This refund is for a claim made at a different outlet.");
    }
    return { role: actor.role, scope: "BRAND" };
  }

  throwError(403, "You are not authorized to view this refund.");
};

exports.assertRefundAccess = assertRefundAccess;
