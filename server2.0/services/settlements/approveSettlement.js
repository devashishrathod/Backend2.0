const Settlement = require("../../models/Settlement");
const Transaction = require("../../models/Transaction");
const RefundRequest = require("../../models/RefundRequest");
const { throwError } = require("../../utils");
const { ROLES } = require("../../constants");
const {
  SETTLEMENT_STATUS,
  SETTLEMENT_ACTOR,
} = require("../../constants/settlement");
const { getCustomerConfig } = require("../../helpers/settings");
const {
  transitionSettlement,
  describeTaintedRows,
} = require("../../helpers/settlements");
const {
  sendQuietly,
  notifyVendorSettlementOnHold,
} = require("../../helpers/notifications");
const { computeTotals } = require("./buildSettlements");

const assertAdmin = (actor) => {
  if (actor?.role !== ROLES.ADMIN) {
    throwError(403, "Only an admin can act on a settlement.");
  }
};

/** `PENDING_APPROVAL` → "pending approval", for messages a person reads. */
const readable = (status) => String(status).toLowerCase().replace(/_/g, " ");

const load = async (settlementId) => {
  const settlement = await Settlement.findOne({
    _id: settlementId,
    isDeleted: false,
  }).lean();
  if (!settlement) throwError(404, "Settlement not found.");
  return settlement;
};

/**
 * An admin signs off a settlement, and that signature is the authority.
 *
 * ### ⚠️ Approval is the last point at which exclusion is free
 *
 * `settlementHold` stops a payment being **claimed**. It does nothing once the
 * claim has happened: eligibility was evaluated at build time and the totals
 * describe what was captured then. Between the 02:00 build and a 14:00 payout
 * there are twelve hours in which a chargeback or a refund request lands on a
 * payment already inside this settlement.
 *
 * So the webhook flags the settlement (`needsRevalidation`), and this is where
 * the flag bites — **in the update filter**, not in an `if` above it. A check
 * that reads the document and then writes leaves exactly the same window it is
 * trying to close: the flag can land between the read and the write.
 *
 * A refusal names the offending transactions rather than saying "revalidation
 * required", because the admin's next action depends on which ones they are.
 */
exports.approveSettlement = async (actor, settlementId, payload = {}) => {
  assertAdmin(actor);
  const settlement = await load(settlementId);

  if (settlement.status !== SETTLEMENT_STATUS.PENDING_APPROVAL) {
    throwError(
      409,
      `This settlement is ${String(settlement.status).toLowerCase().replace(/_/g, " ")} and cannot be approved.`,
    );
  }

  /**
   * ⚠️ A payout to nowhere.
   *
   * `models/Bank.js` is a CGPEY penny-drop record, so a row can exist for an
   * account the drop failed on — `buildSettlements` only snapshots a verified
   * one. No snapshot means there is nothing safe to pay to, and NEFT has no
   * recall.
   */
  if (!settlement.bankSnapshot?.accountLast4Digits) {
    throwError(
      422,
      "This brand has no verified bank account. Ask them to add one, then rebuild this settlement.",
    );
  }

  /**
   * The conditional claim, with the flag in the filter.
   *
   * Two admins on the same screen produce one approval and one 409 — and a
   * chargeback landing a millisecond before the write loses the row rather than
   * being approved past.
   */
  const approved = await Settlement.findOneAndUpdate(
    {
      _id: settlement._id,
      status: SETTLEMENT_STATUS.PENDING_APPROVAL,
      needsRevalidation: { $ne: true },
    },
    {
      $set: {
        status: SETTLEMENT_STATUS.APPROVED,
        approvedBy: actor.userId,
        approvedAt: new Date(),
        isOpen: true,
      },
    },
    { returnDocument: "after" },
  ).lean();

  if (!approved) {
    return refuseAndHold(settlement, actor, payload);
  }

  await recordApproval(approved);
  return present(approved);
};

/**
 * The approval did not land. Work out why, and leave the settlement somewhere an
 * admin can act on.
 */
const refuseAndHold = async (settlement, actor, payload) => {
  const current = await Settlement.findById(settlement._id).lean();

  if (current?.status !== SETTLEMENT_STATUS.PENDING_APPROVAL) {
    throwError(
      409,
      `This settlement was already moved to ${String(current?.status || "another state")
        .toLowerCase()
        .replace(/_/g, " ")}.`,
    );
  }

  // It is still pending, so the flag is what refused it.
  const tainted = await describeTaintedRows(current);

  /**
   * Parked on `ON_HOLD` rather than left pending. A settlement that refuses
   * approval but stays in the approval queue invites the same click again, and
   * the admin learns to treat the error as noise.
   */
  await transitionSettlement({
    settlement: current,
    to: SETTLEMENT_STATUS.ON_HOLD,
    actor,
    reason: `Approval refused: ${tainted.length} claimed payment(s) are no longer eligible`,
  });

  const named = tainted
    .slice(0, 5)
    .map((t) => t.invoiceId || String(t._id))
    .join(", ");

  throwError(
    422,
    `${tainted.length} payment(s) in this settlement are no longer eligible` +
      (named ? ` (${named}${tainted.length > 5 ? ", …" : ""})` : "") +
      ". It has been put on hold — rebuild it to settle the rest.",
  );
};

/**
 * Rebuild a held settlement without the rows that went bad.
 *
 * ### Rebuild, never mutate in place
 *
 * The tainted rows are released; the **clean** ones stay claimed. Releasing
 * everything and re-claiming would look tidier and is wrong: between the release
 * and the re-claim another build could take those rows, and this settlement's
 * number and statement would end up describing a different set of payments than
 * the one an admin is about to approve.
 *
 * Guarded on `ON_HOLD`, so a rebuild cannot run against a settlement somebody is
 * approving.
 */
exports.rebuildSettlement = async (actor, settlementId, payload = {}) => {
  assertAdmin(actor);
  const settlement = await load(settlementId);

  if (settlement.status !== SETTLEMENT_STATUS.ON_HOLD) {
    throwError(
      409,
      "Only a settlement on hold can be rebuilt. Put it on hold first.",
    );
  }

  const taintedIds = settlement.taintedTransactionIds || [];

  /**
   * Only the tainted rows go back. The clean ones stay claimed by this
   * settlement, which is what stops the next build taking them mid-rebuild.
   */
  if (taintedIds.length) {
    await Transaction.updateMany(
      { _id: { $in: taintedIds }, settlementId: settlement._id },
      { $set: { settlementId: null } },
    );
  }

  const [transactions, refunds] = await Promise.all([
    Transaction.find({ settlementId: settlement._id, isDeleted: false }).lean(),
    RefundRequest.find({ settlementId: settlement._id, isDeleted: false }).lean(),
  ]);

  const config = await getCustomerConfig();
  const settings = config.settlement || {};
  const totals = computeTotals({ transactions, refunds, settings });

  await Settlement.updateOne(
    { _id: settlement._id },
    {
      $set: {
        ...totals,
        needsRevalidation: false,
        taintedTransactionIds: [],
      },
    },
  );

  const rebuilt = await Settlement.findById(settlement._id).lean();
  const minPayout = Number(settings.minPayoutAmount) || 0;

  /**
   * A rebuild can empty a settlement out. `CARRIED_FORWARD` releases what is
   * left, and the release **is** the carry forward — eligibility has no
   * `periodStart` floor, so the remaining rows flow into the next cycle.
   */
  const nothingToPay = totals.netPayable <= 0 || totals.netPayable < minPayout;

  const { settlement: moved } = await transitionSettlement({
    settlement: rebuilt,
    to: nothingToPay
      ? SETTLEMENT_STATUS.CARRIED_FORWARD
      : SETTLEMENT_STATUS.PENDING_APPROVAL,
    actor,
    reason:
      payload.reason ||
      `Rebuilt without ${taintedIds.length} ineligible payment(s)`,
  });

  return { ...present(moved), removed: taintedIds.length };
};

/** An admin refuses the whole settlement. Releases everything. */
exports.cancelSettlement = async (actor, settlementId, payload = {}) => {
  assertAdmin(actor);
  const settlement = await load(settlementId);

  const reason = String(payload.reason || "").trim();
  if (!reason) {
    throwError(422, "Please say why you are cancelling this settlement.");
  }

  const { settlement: moved, released } = await transitionSettlement({
    settlement,
    to: SETTLEMENT_STATUS.CANCELLED,
    actor,
    reason,
  });

  return { ...present(moved), released };
};

/**
 * Give up on a payout that will never go through.
 *
 * ### ⚠️ Why this endpoint has to exist
 *
 * `FAILED → ABANDONED` was in the state machine from the start and **nothing
 * ever called it**. `ABANDONED` is the only way a `FAILED` settlement releases
 * its rows — `failPayout` deliberately keeps them, because the ordinary answer
 * to a bounce is to fix the account and retry the same settlement.
 *
 * But some bounces never come good: a brand that has closed, an account that
 * cannot be corrected, a vendor who has left. Without a caller those rows stay
 * claimed by a settlement nobody will ever pay — invisible to every future
 * cycle, for ever, with no error and no log. The exact failure
 * `settlementClaims.js` warns about, reachable through the front door.
 *
 * Retry stays the default. This is the exit when retry is not the answer.
 */
exports.abandonSettlement = async (actor, settlementId, payload = {}) => {
  assertAdmin(actor);
  const settlement = await load(settlementId);

  if (settlement.status !== SETTLEMENT_STATUS.FAILED) {
    throwError(
      409,
      `Only a failed settlement can be abandoned. This one is ${readable(settlement.status)} — ` +
        `cancel it instead if you want its payments back in the next cycle.`,
    );
  }

  const reason = String(payload.reason || "").trim();
  if (!reason) {
    /**
     * Required, and it is not paperwork: this is the one action that writes off
     * a payout attempt entirely. The vendor's money moves to another cycle and
     * somebody will ask why months later.
     */
    throwError(422, "Please say why this payout is being abandoned.");
  }

  const { settlement: moved, released } = await transitionSettlement({
    settlement,
    to: SETTLEMENT_STATUS.ABANDONED,
    actor,
    reason,
  });

  return { ...present(moved), released };
};

/** Put a settlement back for review without cancelling it. */
exports.holdSettlement = async (actor, settlementId, payload = {}) => {
  assertAdmin(actor);
  const settlement = await load(settlementId);

  const { settlement: moved } = await transitionSettlement({
    settlement,
    to: SETTLEMENT_STATUS.ON_HOLD,
    actor,
    reason: payload.reason,
  });

  /**
   * The vendor is told it is held, and not what is being checked.
   *
   * `payload.reason` is deliberately not passed through: it usually names a
   * disputed payment, and telling a vendor which of their claims is under review
   * turns a two-day delay into an argument about a chargeback nobody has ruled
   * on. Support explains when asked.
   */
  await sendQuietly(
    () => notifyVendorSettlementOnHold({ settlement: moved }),
    "vendor settlement on hold",
  );

  return present(moved);
};

/**
 * Approval writes its own history row.
 *
 * Every other edge goes through `transitionSettlement`, which writes one — but
 * approval cannot: its conditional filter has to carry `needsRevalidation`, and
 * that helper takes only a status. Doing the update here and the history here
 * keeps the two together rather than leaving an edge with no trail.
 */
const recordApproval = async (approved) => {
  const SettlementHistory = require("../../models/SettlementHistory");
  try {
    await SettlementHistory.create({
      settlementId: approved._id,
      brandId: approved.brandId,
      settlementNumber: approved.settlementNumber,
      fromStatus: SETTLEMENT_STATUS.PENDING_APPROVAL,
      toStatus: SETTLEMENT_STATUS.APPROVED,
      performedBy: approved.approvedBy,
      performedByRole: SETTLEMENT_ACTOR.ADMIN,
      amount: approved.netPayable,
      snapshot: { bankLast4: approved.bankSnapshot?.accountLast4Digits },
    });
  } catch (error) {
    console.error(
      `[approveSettlement] history row lost for ${approved._id}:`,
      error?.message,
    );
  }
};

const present = (settlement) => ({
  _id: settlement._id,
  settlementNumber: settlement.settlementNumber,
  brandId: settlement.brandId,
  status: settlement.status,
  periodStart: settlement.periodStart,
  periodEnd: settlement.periodEnd,
  netPayable: settlement.netPayable,
  transactionCount: settlement.transactionCount,
  needsRevalidation: settlement.needsRevalidation,
  approvedAt: settlement.approvedAt,
  bankLast4: settlement.bankSnapshot?.accountLast4Digits,
});

exports.present = present;
