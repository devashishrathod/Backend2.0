const Settlement = require("../../models/Settlement");
const PayoutLeg = require("../../models/PayoutLeg");
const Transaction = require("../../models/Transaction");
const SettlementHistory = require("../../models/SettlementHistory");
const { pagination, throwError } = require("../../utils");
const { ROLES } = require("../../constants");
const { PAYOUT_TYPE } = require("../../constants/payout");
const {
  buildSettlementListFilter,
  settlementProjection,
  presentSettlement,
  scopeFor,
} = require("../../helpers/settlements");
const { pickByProjection } = require("../../helpers/transactions");
const { presentLeg } = require("./paySettlement");

/**
 * Settlements, scoped to whoever is asking.
 *
 * **One endpoint, two shapes.** A brand sees its own and an admin sees
 * everything, and each gets a different projection decided in one place rather
 * than by two services that would drift.
 *
 * Sorted newest first, because a settlement list is read to answer *"did last
 * week's money arrive?"* — except the admin worklist, where the oldest is the
 * one that has been waiting longest for a decision.
 */
exports.getSettlements = async (actor, query = {}) => {
  const filter = buildSettlementListFilter(actor, query);
  const wantsWorklist =
    query.needsAttention === true || query.needsAttention === "true";

  const pipeline = [
    { $match: filter },
    { $sort: wantsWorklist ? { createdAt: 1 } : { periodEnd: -1 } },
    { $project: settlementProjection(actor.role) },
  ];

  const result = await pagination(
    Settlement,
    pipeline,
    query.page || 1,
    query.limit || 20,
    "settlement",
    /**
     * A brand that has taken no money yet has an empty list, not a missing one.
     * 404 here makes a perfectly correct answer look like a fault on their first
     * week.
     */
    { allowEmpty: true },
  );

  return {
    ...result,
    data: result.data.map((row) => presentSettlement(row, actor.role)),
  };
};

/**
 * One settlement, with the legs that paid it and the story so far.
 *
 * ### Read whole, checked, then narrowed
 *
 * The row is read in full, checked, and only then narrowed through
 * `pickByProjection`, which is a whitelist and therefore fails closed when the
 * model grows a field. Projecting before the check would mean asking *"is this
 * yours?"* of a document that may no longer say whose it is.
 */
exports.getSettlementDetail = async (actor, settlementId) => {
  const settlement = await Settlement.findOne({
    _id: settlementId,
    isDeleted: false,
  }).lean();

  if (!settlement) throwError(404, "Settlement not found.");

  const scope = scopeFor(actor);
  if (scope.brandId && String(settlement.brandId) !== String(scope.brandId)) {
    throwError(403, "You are not authorized to view this settlement.");
  }

  const [legs, history] = await Promise.all([
    PayoutLeg.find({
      payoutType: PAYOUT_TYPE.SETTLEMENT,
      settlementId: settlement._id,
      isDeleted: false,
    })
      .sort({ legNumber: 1 })
      .lean(),
    SettlementHistory.find({ settlementId: settlement._id })
      // A timeline is read forwards.
      .sort({ createdAt: 1 })
      .lean(),
  ]);

  return {
    settlement: presentSettlement(
      pickByProjection(settlement, settlementProjection(actor.role)),
      actor.role,
    ),
    /**
     * Every leg, with its UTR — the one field a vendor quotes back when money
     * has not landed, and the reason a single `payoutUtr` field was never
     * enough.
     */
    legs: legs.map(presentLeg),
    timeline: history.map((row) => presentHistory(row, actor.role)),
    viewer: { role: actor.role, scope: scope.brandId ? "BRAND" : "ALL" },
  };
};

/**
 * The transactions this settlement actually paid for.
 *
 * Paged separately from the detail because a busy brand's day is hundreds of
 * rows, and a detail endpoint that returned them all would be slow for the
 * ninety-nine percent of calls that only want the total.
 */
exports.getSettlementTransactions = async (actor, settlementId, query = {}) => {
  const settlement = await Settlement.findOne({
    _id: settlementId,
    isDeleted: false,
  })
    .select("brandId")
    .lean();

  if (!settlement) throwError(404, "Settlement not found.");

  const scope = scopeFor(actor);
  if (scope.brandId && String(settlement.brandId) !== String(scope.brandId)) {
    throwError(403, "You are not authorized to view this settlement.");
  }

  const pipeline = [
    { $match: { settlementId: settlement._id, isDeleted: false } },
    { $sort: { verifiedAt: 1 } },
    {
      $project: {
        _id: 1,
        invoiceId: 1,
        verifiedAt: 1,
        fundsReceivedAt: 1,
        amount: 1,
        "voucher.claimId": 1,
        "voucher.billAmount": 1,
        "voucher.netBill": 1,
        "voucher.vendorPayable": 1,
        "voucher.vendorPromoCost": 1,
        /**
         * ⚠️ Not `platformPromoCost`, `gatewayFee` or `netReceived` for a
         * vendor. This is a statement line, and our margin is a commercial
         * disclosure that happens to sit on the same sub-document as the figure
         * they legitimately need.
         */
        ...(actor.role === ROLES.ADMIN
          ? {
              "voucher.platformPromoCost": 1,
              gatewayFee: 1,
              netReceived: 1,
            }
          : {}),
      },
    },
  ];

  return pagination(
    Transaction,
    pipeline,
    query.page || 1,
    query.limit || 50,
    "settled payment",
    { allowEmpty: true },
  );
};

/**
 * What the settlement's history shows each audience.
 *
 * ⚠️ `reason` is written by staff **for staff** — *"approval refused: 3 claimed
 * payments are no longer eligible"* names a dispute nobody has decided yet. A
 * vendor gets the status change and the date; an admin gets the note.
 */
const presentHistory = (row, role) => ({
  at: row.createdAt,
  fromStatus: row.fromStatus,
  toStatus: row.toStatus,
  by: row.performedByRole,
  ...(role === ROLES.ADMIN
    ? { reason: row.reason, performedBy: row.performedBy, snapshot: row.snapshot }
    : {}),
});

exports.presentHistory = presentHistory;
