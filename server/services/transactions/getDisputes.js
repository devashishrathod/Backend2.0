const mongoose = require("mongoose");
const Dispute = require("../../models/Dispute");
const { buildAggregateLookup } = require("../../database");
const { pagination, throwError } = require("../../utils");
const { ROLES } = require("../../constants");
const {
  DISPUTE_STATUS,
  DISPUTE_ACTIONABLE_STATUSES,
} = require("../../constants/webhook");

const RESOLVED = [
  DISPUTE_STATUS.WON,
  DISPUTE_STATUS.LOST,
  DISPUTE_STATUS.CLOSED,
];

/**
 * The chargeback worklist — soonest deadline first.
 *
 * A dispute carries a `respond_by` date; miss it and the case closes in the
 * customer's favour automatically. `disputeDeadlines` warns about that, and this
 * is where somebody acts on it.
 *
 * ### ⚠️ One row per **dispute**, not per payment
 *
 * This read from `Transaction` and its ten denormalised dispute fields, so a
 * payment carrying two disputes — a chargeback and the pre-arbitration that
 * followed it — appeared once, showing only the newest. The other was work
 * nobody could see, with its own deadline and its own money.
 *
 * `Transaction` still carries a summary for filtering elsewhere; `Dispute` is
 * the record, and this lists it.
 */
/**
 * Which disputes this caller may see, and how much of each.
 *
 * ⚠️ A vendor is narrowed to their own brand **in the filter**, not by hiding
 * fields afterwards. A filter that merely looks applied is how somebody builds a
 * report that was never scoped at all — the settlement reads make the same
 * decision the same way.
 *
 * ⚠️ And a CUSTOMER gets nothing. A chargeback is between us and their bank;
 * they raised it there, and a Trydood screen about it can only confuse or
 * inflame. See `docs/dispute_flow.md` §3.
 */
const scopeFor = (actor = {}) => {
  if (actor.role === ROLES.ADMIN) return { admin: true, filter: {} };

  if (actor.role === ROLES.VENDOR || actor.role === ROLES.SUB_VENDOR) {
    const brandId = actor.brandId;
    if (!brandId) throwError(403, "No brand on this account.");
    return { admin: false, filter: { brandId: new mongoose.Types.ObjectId(brandId) } };
  }

  throwError(403, "You are not authorized to view disputes.");
};

/**
 * The derived fields both reads need — deadline arithmetic and whether the
 * vendor was ever paid.
 *
 * ⚠️ Shared, not copied. A detail endpoint that recomputed these is how one of
 * the two ends up leaking a field the other hides, months later, with nothing
 * failing.
 */
const enrichmentStages = () => [
  {
    $addFields: {
      daysToRespond: {
        $cond: [
          // ⚠️ `$ifNull` — see `vendorWasPaid` below. `respondBy` is written only
          // when Razorpay sends one, so it is *absent* rather than null on a
          // dispute that carries no deadline.
          { $ne: [{ $ifNull: ["$respondBy", null] }, null] },
          {
            $ceil: {
              $divide: [
                { $subtract: ["$respondBy", new Date()] },
                1000 * 60 * 60 * 24,
              ],
            },
          },
          null,
        ],
      },
    },
  },
  {
    $addFields: {
      // Deadline already gone, or inside 48 hours.
      isOverdue: {
        $and: [
          { $ne: ["$daysToRespond", null] },
          { $lte: ["$daysToRespond", 0] },
        ],
      },
      isUrgent: {
        $and: [
          { $ne: ["$daysToRespond", null] },
          { $gt: ["$daysToRespond", 0] },
          { $lte: ["$daysToRespond", 2] },
        ],
      },
      /**
       * Whether the vendor was ever paid for this payment.
       *
       * The one thing an admin needs to know before deciding who bears a loss:
       * with no `settlementId` the money never reached them, so there is nothing
       * to recover and the platform is simply out of pocket.
       *
       * ### ⚠️ `$ifNull`, because **missing is not null** in an expression
       *
       * A query filter treats an absent field and an explicit `null` alike. An
       * aggregation *expression* does not: `{$ne: ["$a.b", null]}` is `true`
       * when `b` is absent and `false` when it is `null` — and `settlementId`
       * is simply never written until a settlement claims the payment.
       *
       * So the plain `$ne` read `true` for every payment that had **never been
       * settled** — the exact opposite of the truth, on the one field an admin
       * uses to decide whether there is anything to claw back. It would have
       * sent somebody looking for money in a payout that never happened.
       */
      vendorWasPaid: {
        $ne: [{ $ifNull: ["$payment.settlementId", null] }, null],
      },
    },
  },
];

/**
 * What the vendor sees.
 *
 * ⚠️ **Not** `respond_by`, `daysToRespond`, `isOverdue` or `alertsSent`. Those
 * are our queue: the deadline is ours to meet, the evidence is filed by us, and
 * there is nothing the outlet does differently on the last day than on the
 * first. Showing a countdown they cannot act on turns a warning into anxiety,
 * and the one thing it would reliably produce is a support call.
 *
 * ⚠️ Nor `recoverySettlementId` or `vendorWasPaid` — internal bookkeeping about
 * whether we can claw it back, which is not their side of the question.
 *
 * What they do get is the sale, the amount, where it stands, and whether their
 * money is held or has been deducted.
 */
const vendorProjection = {
  disputeId: 1,
  transactionId: 1,
  invoiceId: "$payment.invoiceId",
  claimAmount: "$payment.paidAmount",
  disputeAmount: "$amount",
  disputeStatus: "$status",
  disputedAt: "$openedAt",
  disputeResolvedAt: "$resolvedAt",
  /** Their own contribution, so they can see it landed. */
  vendorEvidenceNote: 1,
  vendorEvidenceAt: 1,
  createdAt: 1,
};

/**
 * ⚠️ The field names stay as they were.
 *
 * The admin panel reads `disputeStatus`, `disputeRespondBy` and the rest. Moving
 * the data to its own collection is not a reason to rename the response — a
 * screen that silently shows empty cells is worse than the problem this change
 * fixed.
 */
const adminProjection = {
  brand: 1,
  payment: 1,
  transactionId: 1,
  invoiceId: "$payment.invoiceId",
  amount: "$payment.amount",
  paidAmount: "$payment.paidAmount",
  disputeId: 1,
  disputeStatus: "$status",
  disputeAmount: "$amount",
  disputeReason: { $ifNull: ["$reasonCode", "$reason"] },
  disputePhase: "$phase",
  disputedAt: "$openedAt",
  disputeRespondBy: "$respondBy",
  disputeResolvedAt: "$resolvedAt",
  /** How many warnings have gone out — 0 means nobody has been told yet. */
  alertsSent: 1,
  /** Set once a settlement has clawed this loss back from the vendor. */
  recoverySettlementId: 1,
  recoveredAt: 1,
  /** What the outlet added, and whether they were ever asked. */
  vendorEvidenceNote: 1,
  vendorEvidenceAt: 1,
  vendorNotifiedAt: 1,
  /** Closed as unrecoverable — see `writeOffVendorDebt`. */
  writtenOffAt: 1,
  writtenOffReason: 1,
  daysToRespond: 1,
  isOverdue: 1,
  isUrgent: 1,
  vendorWasPaid: 1,
  createdAt: 1,
};

/** The two joins both reads need: whose brand, and which payment. */
const lookupStages = () => [
  ...buildAggregateLookup({
    from: "brands",
    localField: "brandId",
    as: "brand",
    project: { brandName: 1, merchantId: 1, email: 1 },
  }),
  /**
   * The payment behind it, for the claim reference and what was actually
   * charged — a dispute for ₹200 of an ₹810 payment reads very differently from
   * one for the whole thing.
   */
  ...buildAggregateLookup({
    from: "transactions",
    localField: "transactionId",
    as: "payment",
    project: {
      invoiceId: 1,
      amount: 1,
      paidAmount: 1,
      razorpayPaymentId: 1,
      settlementId: 1,
    },
  }),
];

exports.getDisputes = async (actor = {}, query = {}) => {
  const scope = scopeFor(actor);

  let { page, limit, status, brandId, resolved, sortOrder = "asc" } = query;

  page = page ? Number(page) : 1;
  limit = limit ? Number(limit) : 20;

  const match = { isDeleted: false, ...scope.filter };

  if (status) match.status = status;
  else if (resolved === "true" || resolved === true) {
    match.status = { $in: RESOLVED };
  } else {
    // Defaults to the actionable set — a resolved dispute needs nobody.
    match.status = { $in: [...DISPUTE_ACTIONABLE_STATUSES] };
  }

  /**
   * ⚠️ Only an admin's `brandId` filter is honoured — a vendor's own scope is
   * already in `match` and must not be widened by a query string. A vendor
   * passing somebody else's id gets an empty page, not their rows.
   */
  if (brandId && scope.admin) {
    match.brandId = new mongoose.Types.ObjectId(brandId);
  }

  const pipeline = [
    { $match: match },
    ...lookupStages(),
    ...enrichmentStages(),
  ];

  /**
   * ⚠️ Sorted **before** the projection, on the real field.
   *
   * The sort used to sit after `$project` and key on `disputeRespondBy`, which
   * only exists in the admin shape — so a vendor's list came back in whatever
   * order the collection happened to give, silently. Sorting on `respondBy`
   * while it is still there fixes both shapes at once.
   *
   * Soonest deadline first: that is the order an admin must work them in, and
   * for a vendor it puts the freshest disputes at the top.
   */
  pipeline.push({ $sort: { respondBy: sortOrder === "desc" ? -1 : 1 } });

  pipeline.push({
    $project: scope.admin ? adminProjection : vendorProjection,
  });

  return pagination(Dispute, pipeline, page, limit, "dispute", {
    allowEmpty: true,
  });
};

/**
 * One dispute, in the same two shapes the list uses.
 *
 * ### ⚠️ The projections are **shared with the list**, not copied
 *
 * A detail endpoint that spelled its own projection out is the ordinary way a
 * field the list carefully hides ends up on the detail screen — months later,
 * with nothing failing and nobody looking. `vendorProjection` and
 * `adminProjection` are declared once, above, and both reads use them.
 *
 * ### Addressable by either id
 *
 * Razorpay's `disp_…` is what an admin reads off the dashboard and what every
 * alert and webhook carries; our `_id` is what a panel holds after a list call.
 * Refusing one of them would reject the id the person actually has in front of
 * them.
 *
 * ⚠️ A dispute belonging to another brand answers exactly as one that does not
 * exist. Saying *"it exists but is not yours"* confirms the id is real, which is
 * a slow way of mapping other people's chargebacks.
 */
exports.getDispute = async (actor = {}, disputeId) => {
  const scope = scopeFor(actor);

  const match = {
    isDeleted: false,
    ...scope.filter,
    $or: [
      { disputeId: String(disputeId) },
      ...(String(disputeId).match(/^[0-9a-fA-F]{24}$/)
        ? [{ _id: new mongoose.Types.ObjectId(String(disputeId)) }]
        : []),
    ],
  };

  const [row] = await Dispute.aggregate([
    { $match: match },
    ...lookupStages(),
    ...enrichmentStages(),
    { $project: scope.admin ? adminProjection : vendorProjection },
    { $limit: 1 },
  ]);

  if (!row) throwError(404, "Dispute not found.");
  return row;
};

exports.vendorDisputeProjection = vendorProjection;
exports.adminDisputeProjection = adminProjection;
