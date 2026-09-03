const mongoose = require("mongoose");
const { ROLES } = require("../../constants");
const {
  SETTLEMENT_STATUS,
  SETTLEMENT_OPEN_STATUSES,
} = require("../../constants/settlement");

const asId = (value) =>
  value ? new mongoose.Types.ObjectId(String(value)) : undefined;

/**
 * What a settlement listing accepts, narrowed to what the caller may see.
 *
 * A settlement belongs to exactly one brand, so the scope is simpler than the
 * money listings — but the rule is the same: the caller's filters and the scope
 * are **intersected**, never overlaid. A vendor asking `?brandId=<someone else>`
 * gets nothing rather than their own rows, because a filter that looks like it
 * worked is how somebody builds a report on a filter that never applied.
 */
exports.buildSettlementListFilter = (actor, query = {}) => {
  const filter = { isDeleted: false };

  if (query.status) filter.status = query.status;
  if (query.settlementNumber) {
    filter.settlementNumber = String(query.settlementNumber).trim();
  }

  /**
   * `?open=true` is the worklist — everything still holding rows. Keyed on the
   * denormalised flag rather than a status list, because Mongo cannot use an
   * index for "in one of these six" the way it can for a boolean.
   */
  if (query.open !== undefined) {
    filter.isOpen = query.open === true || query.open === "true";
  }

  /**
   * `?needsAttention=true` — the admin worklist proper: flagged for
   * revalidation, or a bounced payout waiting on a decision.
   */
  if (query.needsAttention === true || query.needsAttention === "true") {
    filter.$or = [
      { needsRevalidation: true },
      { status: SETTLEMENT_STATUS.FAILED },
      { status: SETTLEMENT_STATUS.ON_HOLD },
    ];
  }

  if (query.from || query.to) {
    filter.periodEnd = {
      ...(query.from ? { $gte: new Date(query.from) } : {}),
      // Inclusive of the whole end day — a report "up to the 31st" that stops at
      // midnight silently drops a day.
      ...(query.to
        ? { $lte: new Date(new Date(query.to).setHours(23, 59, 59, 999)) }
        : {}),
    };
  }

  const scope = scopeFor(actor);
  if (query.brandId) {
    const asked = asId(query.brandId);
    if (scope.brandId && String(scope.brandId) !== String(asked)) {
      // Nothing matches, rather than quietly matching the caller's own brand.
      return { _id: null };
    }
    filter.brandId = asked;
  }

  return { ...filter, ...scope };
};

/**
 * A settlement is a brand's money, so only that brand and an admin may read it.
 *
 * ⚠️ Deliberately **not** `buildAccessScopeFilter`: that one scopes a
 * `SUB_VENDOR` down to their outlet, which is right for claims and wrong here. A
 * settlement covers the whole brand's day across every outlet, so narrowing it
 * by outlet would show an outlet manager a figure that does not add up to
 * anything they can see — and hide money the brand is genuinely owed.
 */
const scopeFor = (actor = {}) => {
  const { throwError } = require("../../utils");

  if (actor.role === ROLES.ADMIN) return {};

  if (actor.role === ROLES.VENDOR || actor.role === ROLES.SUB_VENDOR) {
    if (!actor.brandId) throwError(403, "No brand is linked to this account.");
    return { brandId: actor.brandId };
  }

  throwError(403, "You are not authorized to view settlements.");
};

/**
 * What each audience reads off a settlement.
 *
 * ### What a vendor never sees
 *
 * | Field | Why |
 * |---|---|
 * | `taintedTransactionIds` | names payments under dispute, before any decision |
 * | `needsRevalidation` | an internal review state; "your payout is delayed" is the honest version |
 * | `idempotencyKey` | internal plumbing |
 * | `approvedBy` | which admin signed it off is not their business |
 * | `failureNote` | staff-to-staff — the vendor gets `failureReason` instead |
 *
 * `needsRevalidation` is the interesting one. Telling a vendor *"three of your
 * payments are being revalidated"* invites them to ask which, and the answer is
 * usually a chargeback we have not decided yet. The status they see is
 * `ON_HOLD`, and support can explain.
 */
exports.settlementProjection = (role) => {
  const base = {
    _id: 1,
    settlementNumber: 1,
    brandId: 1,
    periodStart: 1,
    periodEnd: 1,
    cycleType: 1,
    status: 1,
    isOpen: 1,
    createdAt: 1,

    // The breakdown a vendor needs to check the figure against their own books.
    grossCollected: 1,
    vendorPromoCost: 1,
    commissionAmount: 1,
    commissionTax: 1,
    refundAdjustment: 1,
    chargebackAdjustment: 1,
    reserveHeld: 1,
    reserveReleased: 1,
    netPayable: 1,
    transactionCount: 1,

    statementUrl: 1,
  };

  if (role === ROLES.ADMIN) {
    return {
      ...base,
      /**
       * ⚠️ The whole sub-document, and **none** of the narrowed paths.
       *
       * Naming a path and its parent in one $project is rejected outright —
       * *"Path collision at bankSnapshot"* — so the admin projection cannot
       * inherit `bankSnapshot.accountLast4Digits` from a shared base. Verified
       * against the live database in 1C, on `voucher.claimId`.
       */
      bankSnapshot: 1,
      idempotencyKey: 1,
      needsRevalidation: 1,
      taintedTransactionIds: 1,
      approvedBy: 1,
      approvedAt: 1,
      payoutProvider: 1,
      failureReason: 1,
      failureNote: 1,
      attemptCount: 1,
      statementToken: 1,
    };
  }

  // VENDOR and SUB_VENDOR.
  return {
    ...base,
    // The last four digits and the bank name, never the account itself.
    "bankSnapshot.accountLast4Digits": 1,
    "bankSnapshot.bankName": 1,
    approvedAt: 1,
    // The category, not the staff note.
    failureReason: 1,
  };
};

/**
 * Dress a settlement for the audience reading it.
 *
 * `statusLabel` rides along so one response serves the vendor panel and the
 * admin worklist. A vendor is never shown `PENDING_APPROVAL` as itself — from
 * their side there is nothing pending about it, the money is simply on its way.
 */
const VENDOR_STATUS_LABEL = Object.freeze({
  [SETTLEMENT_STATUS.DRAFT]: "Being prepared",
  [SETTLEMENT_STATUS.PENDING_APPROVAL]: "Being prepared",
  [SETTLEMENT_STATUS.APPROVED]: "Scheduled for payout",
  [SETTLEMENT_STATUS.PROCESSING]: "On its way to your bank",
  [SETTLEMENT_STATUS.PAID]: "Paid",
  [SETTLEMENT_STATUS.FAILED]: "Payout failed — we are on it",
  [SETTLEMENT_STATUS.ON_HOLD]: "On hold — being checked",
  [SETTLEMENT_STATUS.REVERSED]: "Reversed by the bank",
  [SETTLEMENT_STATUS.CANCELLED]: "Cancelled",
  [SETTLEMENT_STATUS.ABANDONED]: "Cancelled",
  [SETTLEMENT_STATUS.CARRIED_FORWARD]: "Carried forward to the next payout",
});

exports.presentSettlement = (settlement, role) => {
  if (!settlement) return settlement;

  return {
    ...settlement,
    statusLabel:
      role === ROLES.ADMIN
        ? settlement.status
        : VENDOR_STATUS_LABEL[settlement.status] || settlement.status,
    isOpen: SETTLEMENT_OPEN_STATUSES.includes(settlement.status),
    /**
     * Stated rather than inferred. A panel that works out "can I approve this?"
     * from the status will get it wrong the first time a state is added.
     */
    canApprove:
      role === ROLES.ADMIN &&
      settlement.status === SETTLEMENT_STATUS.PENDING_APPROVAL &&
      !settlement.needsRevalidation,
    canPay: role === ROLES.ADMIN && settlement.status === SETTLEMENT_STATUS.APPROVED,
    canRetry: role === ROLES.ADMIN && settlement.status === SETTLEMENT_STATUS.FAILED,
  };
};

exports.VENDOR_STATUS_LABEL = VENDOR_STATUS_LABEL;
exports.scopeFor = scopeFor;
