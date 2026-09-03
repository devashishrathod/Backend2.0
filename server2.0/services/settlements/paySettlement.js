const mongoose = require("mongoose");
const Settlement = require("../../models/Settlement");
const PayoutLeg = require("../../models/PayoutLeg");
const Brand = require("../../models/Brand");
const Bank = require("../../models/Bank");
const { throwError } = require("../../utils");
const { ROLES } = require("../../constants");
const {
  SETTLEMENT_STATUS,
  SETTLEMENT_FAILURE_REASON,
  SETTLEMENT_ACTOR,
} = require("../../constants/settlement");
const {
  PAYOUT_TYPE,
  PAYOUT_LEG_STATUS,
  PAYOUT_MODE,
} = require("../../constants/payout");
const { PAYOUT_PROVIDERS } = require("../../constants/customer");
const { DUPLICATE_KEY } = require("../../constants/mongo");
const { transitionSettlement } = require("../../helpers/settlements");
const {
  postPayoutEntries,
  reversePayoutEntries,
} = require("../../helpers/ledger");
const {
  sendQuietly,
  notifyVendorSettlementPaid,
  notifyVendorSettlementFailed,
} = require("../../helpers/notifications");
const { present } = require("./approveSettlement");

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const assertAdmin = (actor) => {
  if (actor?.role !== ROLES.ADMIN) {
    throwError(403, "Only an admin can act on a settlement.");
  }
};

const load = async (settlementId) => {
  const settlement = await Settlement.findOne({
    _id: settlementId,
    isDeleted: false,
  }).lean();
  if (!settlement) throwError(404, "Settlement not found.");
  return settlement;
};

/**
 * Start the payout — the last moment before money leaves.
 *
 * ### ⚠️ The live account is checked against the frozen one
 *
 * `buildSettlements` freezes `bankSnapshot` so a vendor cannot redirect a payout
 * an admin has already approved. But a vendor changing their account mid-cycle
 * is not an attack — it is usually a closed account, and paying into it is worse
 * than not paying at all: the NEFT bounces days later, or lands somewhere the
 * vendor no longer controls.
 *
 * So `APPROVED → PROCESSING` compares the two. A mismatch is not an error to
 * push past; the settlement goes `ON_HOLD` and the admin is told which account
 * changed. NEFT has no recall.
 *
 * ### One leg, claimed by a unique index
 *
 * `(payoutType, settlementId, legNumber)` is unique, so a double-click produces
 * one leg and one 409 rather than two NEFTs for the same money.
 */
exports.startPayout = async (actor, settlementId, payload = {}) => {
  assertAdmin(actor);
  const settlement = await load(settlementId);

  /**
   * ⚠️ `PROCESSING` is allowed too, and only for the next leg of a split.
   *
   * A large MANUAL_BANK payout goes out as several NEFTs. `confirmPayout`
   * already knows how to leave a settlement `PROCESSING` when the legs do not
   * yet add up — but there was no way to open the leg that finishes it, because
   * this refused anything that was not `APPROVED`. The split branch was
   * unreachable, so every payout was recorded as one full transfer whatever
   * actually left the bank.
   *
   * Guarded below on there being no leg already in flight, so this cannot be
   * used to open two NEFTs for the same money.
   */
  const isContinuation = settlement.status === SETTLEMENT_STATUS.PROCESSING;

  if (
    settlement.status !== SETTLEMENT_STATUS.APPROVED &&
    !isContinuation
  ) {
    throwError(
      409,
      `This settlement is ${readable(settlement.status)} and is not ready to pay.`,
    );
  }

  if (isContinuation) {
    const inFlight = await currentLeg(settlement._id);
    if (inFlight) {
      throwError(
        409,
        `Leg ${inFlight.legNumber} of this payout is still in flight. ` +
          `Confirm it with its UTR, or mark it failed, before starting another.`,
      );
    }
  }

  /**
   * ⚠️ Re-checked **here**, not only at approval.
   *
   * `taintSettlement` acts on `SETTLEMENT_PRE_PAYOUT_STATUSES`, and `APPROVED`
   * is one of them — so a `dispute.created` or a refund landing between the
   * approval and the payout flags a settlement that has already been signed off.
   * Approval checking the flag is not enough: the whole point of that window is
   * that hours pass inside it, and this is the last moment before money leaves
   * by a route with no recall.
   *
   * `ON_HOLD` rather than a bare refusal, so the settlement lands on the
   * worklist that already exists for it instead of being refused again on the
   * admin's next click with nothing to act on.
   */
  if (settlement.needsRevalidation) {
    await transitionSettlement({
      settlement,
      to: SETTLEMENT_STATUS.ON_HOLD,
      actor,
      reason:
        `Payout stopped: ${(settlement.taintedTransactionIds || []).length} claimed ` +
        `payment(s) stopped being eligible after approval`,
    });

    throwError(
      409,
      "Some payments in this settlement stopped being eligible after it was " +
        "approved, so the payout was stopped and the settlement put on hold. " +
        "Rebuild it to drop them, then approve it again.",
    );
  }

  if (!(settlement.netPayable > 0)) {
    /**
     * Reachable only if something wrote a non-positive payable onto an approved
     * settlement. `CARRIED_FORWARD` is where that belongs — a `PAID` settlement
     * writes a `PAYOUT` ledger entry, and booking a payout for money no bank
     * transfer carried makes `reconcileLedger` shout about drift.
     */
    throwError(422, "There is nothing to pay on this settlement.");
  }

  await assertBankUnchanged(settlement, actor);

  /**
   * The next leg number, and the unique index is what settles a race — not this
   * count, which two clicks would both read as the same value.
   */
  const legNumber =
    (await PayoutLeg.countDocuments({
      payoutType: PAYOUT_TYPE.SETTLEMENT,
      settlementId: settlement._id,
    })) + 1;

  /**
   * ⚠️ What is **still owed**, not the settlement's whole payable.
   *
   * This used to be `settlement.netPayable` on every leg. On a split payout that
   * makes the second leg claim the full amount again, and on the first it means
   * confirming a ₹400 NEFT records ₹800 — `paidTotal` then clears `netPayable`
   * and the settlement closes as `PAID` with half the money never sent. The
   * vendor is short and the system says they were paid in full.
   */
  const alreadyPaid = await paidTotal(settlement._id);
  const outstanding = round2(settlement.netPayable - alreadyPaid);

  if (!(outstanding > 0)) {
    throwError(422, "This settlement has already been paid in full.");
  }

  let leg;
  try {
    leg = await PayoutLeg.create({
      payoutType: PAYOUT_TYPE.SETTLEMENT,
      settlementId: settlement._id,
      brandId: settlement.brandId,
      legNumber,
      amount: outstanding,
      provider: settlement.payoutProvider || PAYOUT_PROVIDERS.MANUAL_BANK,
      status: PAYOUT_LEG_STATUS.INITIATED,
      initiatedBy: actor.userId,
      /**
       * The payee for **this attempt**, not the settlement's build-time copy. A
       * retry after a bank change must record where that attempt actually sent
       * the money, or the UTR on file points at an account nobody paid.
       */
      bankSnapshot: settlement.bankSnapshot,
    });
  } catch (error) {
    /**
     * ⚠️ `payout_settlement_inflight_unique` is what makes that sentence true.
     *
     * The `legNumber` index alone did not: `legNumber` comes from **counting**
     * the existing legs, so two concurrent starts took 1 and 2 and both inserts
     * passed. Only one then won the status transition, and the loser's leg was
     * left `INITIATED` and orphaned — which `sweepStalePayouts` reports as money
     * that may already have moved, and an admin confirming it pays the vendor
     * twice.
     */
    if (error?.code === DUPLICATE_KEY) {
      throwError(409, "A payout for this settlement is already in flight.");
    }
    throw error;
  }

  /**
   * The status moves **after** the leg exists.
   *
   * A crash in between leaves an `APPROVED` settlement with an `INITIATED` leg —
   * visible, and the sweep can resolve it. The other order leaves a
   * `PROCESSING` settlement with no leg at all, which reads as money in flight
   * that nobody can find.
   */
  /**
   * ⚠️ A continuation is already `PROCESSING`, and the machine has no
   * `PROCESSING → PROCESSING` edge — asking for one is a 422, which would leave
   * the leg created and the call failed.
   *
   * So the second and later legs of a split bump the attempt counter and record
   * their own history row without a status change. The status is already right;
   * there is nothing to move it to.
   */
  let moved = settlement;

  if (isContinuation) {
    moved = await Settlement.findOneAndUpdate(
      { _id: settlement._id, status: SETTLEMENT_STATUS.PROCESSING },
      { $inc: { attemptCount: 1 } },
      { returnDocument: "after" },
    ).lean();

    await recordSplitLegHistory({ settlement, legNumber, actor });
  } else {
    ({ settlement: moved } = await transitionSettlement({
      settlement,
      to: SETTLEMENT_STATUS.PROCESSING,
      actor,
      reason: `Payout leg ${legNumber} initiated`,
      set: { attemptCount: (settlement.attemptCount || 0) + 1 },
    }));
  }

  return { ...present(moved), leg: presentLeg(leg.toObject()) };
};

/**
 * A history row for a split payout's later legs.
 *
 * `transitionSettlement` writes one for every status change, and a continuation
 * has none — but "leg 2 opened for the remaining ₹400" is exactly what somebody
 * reconciling a bank statement needs to see. Failure-tolerant for the same
 * reason the transition's own history row is: a lost line must not undo a leg
 * that has been created.
 */
const recordSplitLegHistory = async ({ settlement, legNumber, actor }) => {
  try {
    const SettlementHistory = require("../../models/SettlementHistory");
    await SettlementHistory.create({
      settlementId: settlement._id,
      brandId: settlement.brandId,
      settlementNumber: settlement.settlementNumber,
      fromStatus: SETTLEMENT_STATUS.PROCESSING,
      toStatus: SETTLEMENT_STATUS.PROCESSING,
      performedBy: actor?.userId,
      performedByRole: actor?.role
        ? SETTLEMENT_ACTOR.ADMIN
        : SETTLEMENT_ACTOR.SYSTEM,
      reason: `Payout leg ${legNumber} initiated for the remaining balance`,
      amount: settlement.netPayable,
    });
  } catch (error) {
    console.error(
      `[paySettlement] history row lost for split leg ${legNumber} on ${settlement._id}:`,
      error?.message,
    );
  }
};

/**
 * The money landed. An admin types in the UTR from their banking screen.
 *
 * `MANUAL_BANK` has no callback — a person is the confirmation, which is why the
 * UTR is required and why this is a separate step from `startPayout` rather than
 * one button.
 */
exports.confirmPayout = async (actor, settlementId, payload = {}) => {
  assertAdmin(actor);
  const settlement = await load(settlementId);

  if (settlement.status !== SETTLEMENT_STATUS.PROCESSING) {
    throwError(
      409,
      `This settlement is ${readable(settlement.status)} and has no payout to confirm.`,
    );
  }

  const utr = String(payload.utr || "").trim();
  if (!utr) {
    throwError(
      422,
      "The bank reference (UTR) is required — it is what a vendor quotes back when money has not landed.",
    );
  }

  const leg = await currentLeg(settlement._id);

  if (!leg) {
    /**
     * ⚠️ No leg in flight — but the legs already paid may add up.
     *
     * `confirmPayout` marks the leg `PAID` and books the ledger **before** it
     * transitions the settlement. A throw in between leaves a `PROCESSING`
     * settlement whose money has entirely gone: nothing to confirm, and
     * `startPayout` refuses because there is nothing left to pay. Terminally
     * stuck, with the vendor paid and the record saying otherwise.
     *
     * So a confirmation that arrives with no open leg finishes the job the
     * crashed one started, rather than refusing. Idempotent: the transition is a
     * conditional claim, and the ledger poster is guarded by its own unique
     * index.
     */
    const already = await paidTotal(settlement._id);
    if (already >= round2(settlement.netPayable) - 0.005) {
      const { settlement: healed } = await transitionSettlement({
        settlement,
        to: SETTLEMENT_STATUS.PAID,
        actor,
        reason: `Completed after an interrupted confirmation; ${await legCount(settlement._id)} leg(s) already paid`,
      });

      return {
        ...present(healed),
        leg: null,
        paidSoFar: already,
        remaining: 0,
        settled: true,
        healed: true,
      };
    }

    throwError(
      422,
      `This settlement has no payout leg to confirm. ` +
        `${round2(settlement.netPayable - already).toFixed(2)} is still owed — start the next leg.`,
    );
  }

  /**
   * ⚠️ What the bank actually moved, which is not always what the leg planned.
   *
   * An admin splitting a large payout keys in less than the leg was opened for.
   * Without this the leg records its planned amount, `paidTotal` clears
   * `netPayable`, and a half-sent payout is closed as `PAID` — the vendor short,
   * the ledger booking money that never left, and nothing anywhere disagreeing.
   *
   * Defaults to the leg's amount, so the ordinary single-NEFT case is unchanged.
   * More than the leg was opened for is refused: that is a typo, and the leg is
   * what the bank instruction was raised against.
   */
  const paidAmount =
    payload.amount === undefined || payload.amount === null
      ? round2(leg.amount)
      : round2(payload.amount);

  if (!(paidAmount > 0)) {
    throwError(422, "The amount actually transferred has to be more than zero.");
  }

  if (paidAmount > round2(leg.amount) + 0.005) {
    throwError(
      422,
      `This leg was raised for ${leg.amount.toFixed(2)}. ` +
        `Record what actually left the bank — if more went out, that is a second leg.`,
    );
  }

  /**
   * Conditional on the leg still being in flight, so two admins confirming the
   * same NEFT produce one record and one 409.
   */
  const paidLeg = await PayoutLeg.findOneAndUpdate(
    { _id: leg._id, status: PAYOUT_LEG_STATUS.INITIATED },
    {
      $set: {
        status: PAYOUT_LEG_STATUS.PAID,
        // What the bank moved, not what the leg was opened for.
        amount: paidAmount,
        utr,
        mode: payload.mode || PAYOUT_MODE.NEFT,
        providerReference: payload.reference || utr,
        paidAt: payload.paidAt ? new Date(payload.paidAt) : new Date(),
      },
    },
    { returnDocument: "after" },
  ).lean();

  if (!paidLeg) throwError(409, "This payout was already confirmed by someone else.");

  const paidSoFar = await paidTotal(settlement._id);
  const isFinalLeg = paidSoFar >= round2(settlement.netPayable) - 0.005;

  /**
   * The ledger is written as soon as the leg is confirmed, not only when the
   * settlement completes.
   *
   * A split payout's first NEFT has genuinely left our account. Waiting for the
   * second leg to book both would leave the books claiming we still hold money
   * that is already gone.
   */
  await postPayoutEntries({ leg: paidLeg, settlement, isFinalLeg });

  /**
   * ⚠️ The settlement is only `PAID` once the legs add up.
   *
   * A large payout split across two NEFTs is an ordinary MANUAL_BANK operation.
   * Marking the settlement paid on the first leg would release it from every
   * worklist while half the money is still owed — and the vendor would have no
   * way to say so except by counting their own bank statement.
   */
  if (!isFinalLeg) {
    return {
      ...present(settlement),
      leg: presentLeg(paidLeg),
      paidSoFar,
      remaining: round2(settlement.netPayable - paidSoFar),
      settled: false,
    };
  }

  const { settlement: moved } = await transitionSettlement({
    settlement,
    to: SETTLEMENT_STATUS.PAID,
    actor,
    reason: `Paid in ${await legCount(settlement._id)} leg(s); UTR ${utr}`,
  });

  /**
   * Only on the final leg, and only after the status moved.
   *
   * `sendQuietly` because the money has already left: a push provider being down
   * must not turn a completed payout into a 500 that an admin then retries,
   * against a settlement that is now `PAID` and would refuse them anyway.
   */
  await sendQuietly(
    () => notifyVendorSettlementPaid({ settlement: moved, utr }),
    "vendor settlement paid",
  );

  return {
    ...present(moved),
    leg: presentLeg(paidLeg),
    paidSoFar,
    remaining: 0,
    settled: true,
  };
};

/**
 * The bank bounced it.
 *
 * ⚠️ The failed leg is **kept**, not edited. A retry is a new leg with the next
 * number, so the record holds both attempts — the one that bounced and the one
 * that worked, each with its own UTR and payee. Editing the first would erase
 * the fact that money was ever sent to that account, which is exactly what an
 * investigation needs.
 *
 * The settlement goes to `FAILED`, which does **not** release its rows: a bounce
 * is ordinary and the right operation is to fix the account and retry the same
 * settlement, keeping its number and its statement.
 */
exports.failPayout = async (actor, settlementId, payload = {}) => {
  assertAdmin(actor);
  const settlement = await load(settlementId);

  if (settlement.status !== SETTLEMENT_STATUS.PROCESSING) {
    throwError(
      409,
      `This settlement is ${readable(settlement.status)} and has no payout in flight.`,
    );
  }

  const note = String(payload.note || "").trim();
  if (!note) throwError(422, "Please say what the bank reported.");

  const leg = await currentLeg(settlement._id);
  if (leg) {
    await PayoutLeg.updateOne(
      { _id: leg._id, status: PAYOUT_LEG_STATUS.INITIATED },
      {
        $set: {
          status: PAYOUT_LEG_STATUS.FAILED,
          failedAt: new Date(),
          failureReason: note.slice(0, 500),
        },
      },
    );
  }

  const { settlement: moved } = await transitionSettlement({
    settlement,
    to: SETTLEMENT_STATUS.FAILED,
    actor,
    reason: note,
    set: {
      failureReason: payload.reason || SETTLEMENT_FAILURE_REASON.BANK_REJECTED,
      failureNote: note.slice(0, 500),
    },
  });

  /**
   * The **category**, never `note`. The note is what the admin typed for other
   * admins; the category is what tells a vendor whether the thing to fix is
   * theirs (a closed account) or ours.
   */
  await sendQuietly(
    () =>
      notifyVendorSettlementFailed({
        settlement: moved,
        reason: payload.reason || SETTLEMENT_FAILURE_REASON.BANK_REJECTED,
      }),
    "vendor settlement failed",
  );

  return present(moved);
};

/**
 * Try again after a bounce — same settlement, same number, same statement.
 *
 * The bank snapshot is **refreshed** here, because the usual reason a payout
 * bounced is that the account was wrong. Retrying into the same wrong account is
 * the one thing that is certain not to work.
 */
exports.retryPayout = async (actor, settlementId) => {
  assertAdmin(actor);
  const settlement = await load(settlementId);

  if (settlement.status !== SETTLEMENT_STATUS.FAILED) {
    throwError(
      409,
      `Only a failed settlement can be retried. This one is ${readable(settlement.status)}.`,
    );
  }

  const fresh = await liveBankSnapshot(settlement.brandId);
  if (!fresh) {
    throwError(
      422,
      "This brand still has no verified bank account. Ask them to add one before retrying.",
    );
  }

  const { settlement: moved } = await transitionSettlement({
    settlement,
    to: SETTLEMENT_STATUS.APPROVED,
    actor,
    reason: "Retrying after a failed payout; bank details refreshed",
    set: { bankSnapshot: fresh, needsRevalidation: false },
  });

  return present(moved);
};

// ---------------------------------------------------------------------------

/**
 * Refuse to pay into an account that is not the one that was approved.
 *
 * Not an error to push past: the settlement is parked so an admin can look. A
 * vendor changing their account mid-cycle usually means the old one is closed,
 * and a bounce days later is the good outcome — the bad one is money landing
 * somewhere they no longer control.
 */
const assertBankUnchanged = async (settlement, actor) => {
  const live = await liveBankSnapshot(settlement.brandId);
  const frozen = settlement.bankSnapshot;

  if (!frozen?.accountLast4Digits) {
    throwError(422, "This settlement has no verified bank account to pay into.");
  }

  if (!live) {
    await parkOnHold(settlement, actor, "The brand's bank account is no longer verified");
    throwError(
      422,
      "The brand's bank account is no longer verified. The settlement is on hold.",
    );
  }

  const changed =
    live.accountLast4Digits !== frozen.accountLast4Digits ||
    live.ifscCode !== frozen.ifscCode;

  if (changed) {
    await parkOnHold(
      settlement,
      actor,
      `Bank account changed since approval (…${frozen.accountLast4Digits} → …${live.accountLast4Digits})`,
    );
    throwError(
      422,
      `This brand's bank account changed after the settlement was approved ` +
        `(…${frozen.accountLast4Digits} → …${live.accountLast4Digits}). ` +
        `It is on hold — check with the brand, then rebuild and re-approve.`,
    );
  }
};

const parkOnHold = async (settlement, actor, reason) => {
  await transitionSettlement({
    settlement,
    to: SETTLEMENT_STATUS.ON_HOLD,
    actor,
    reason,
  });
};

/**
 * The account as it stands now.
 *
 * `isVerified`, not just "a record exists" — `models/Bank.js` is a CGPEY
 * penny-drop verification record, so a row can exist for an account the drop
 * failed on.
 */
const liveBankSnapshot = async (brandId) => {
  const brand = await Brand.findById(brandId).select("BankId").lean();
  if (!brand?.BankId) return null;

  const bank = await Bank.findOne({
    _id: brand.BankId,
    isDeleted: false,
  }).lean();
  if (!bank?.isVerified) return null;

  return {
    accountHolderName: bank.accountHolderName,
    maskedAccountNumber: bank.maskedAccountNumber,
    accountLast4Digits: bank.accountLast4Digits,
    ifscCode: bank.ifscCode,
    bankName: bank.bankName,
    bankId: bank._id,
    verifiedAt: bank.verifiedAt || bank.updatedAt,
  };
};

const currentLeg = async (settlementId) =>
  PayoutLeg.findOne({
    payoutType: PAYOUT_TYPE.SETTLEMENT,
    settlementId,
    status: PAYOUT_LEG_STATUS.INITIATED,
    isDeleted: false,
  })
    .sort({ legNumber: -1 })
    .lean();

const legCount = async (settlementId) =>
  PayoutLeg.countDocuments({
    payoutType: PAYOUT_TYPE.SETTLEMENT,
    settlementId,
    status: PAYOUT_LEG_STATUS.PAID,
  });

const paidTotal = async (settlementId) => {
  const rows = await PayoutLeg.aggregate([
    {
      $match: {
        payoutType: PAYOUT_TYPE.SETTLEMENT,
        settlementId: new mongoose.Types.ObjectId(String(settlementId)),
        status: PAYOUT_LEG_STATUS.PAID,
        isDeleted: { $ne: true },
      },
    },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return round2(rows[0]?.total || 0);
};

const readable = (status) => String(status).toLowerCase().replace(/_/g, " ");

const presentLeg = (leg) => ({
  _id: leg._id,
  legNumber: leg.legNumber,
  amount: leg.amount,
  status: leg.status,
  utr: leg.utr,
  mode: leg.mode,
  provider: leg.provider,
  bankLast4: leg.bankSnapshot?.accountLast4Digits,
  initiatedAt: leg.initiatedAt,
  paidAt: leg.paidAt,
  failureReason: leg.failureReason,
});

exports.presentLeg = presentLeg;
exports.liveBankSnapshot = liveBankSnapshot;
exports.paidTotal = paidTotal;

/**
 * The bank pulled a completed payout back.
 *
 * ### ⚠️ Ledger first, rows second
 *
 * `transitionSettlement` releases the claimed rows when a settlement reaches
 * `REVERSED`, and it runs `beforeRelease` **before** doing so. That ordering is
 * the whole point: a crash between the two leaves an over-stated reversal —
 * visible in the ledger, and correctable. The other order leaves the rows
 * released with no reversal booked, which reads as money that was never paid and
 * is free to be settled a second time.
 *
 * `PAID` is the only status this can be reached from, so a settlement that never
 * paid cannot produce a spurious reversal and break the ledger's invariants.
 */
exports.reversePayout = async (actor, settlementId, payload = {}) => {
  assertAdmin(actor);
  const settlement = await load(settlementId);

  const reason = String(payload.reason || "").trim();
  if (!reason) {
    throwError(422, "Please say why this payout is being reversed.");
  }

  const paidLegs = await PayoutLeg.find({
    payoutType: PAYOUT_TYPE.SETTLEMENT,
    settlementId: settlement._id,
    status: PAYOUT_LEG_STATUS.PAID,
    isDeleted: false,
  }).lean();

  const { settlement: moved, released } = await transitionSettlement({
    settlement,
    to: SETTLEMENT_STATUS.REVERSED,
    actor,
    reason,
    beforeRelease: async () => {
      await reversePayoutEntries({ legs: paidLegs, settlement, reason });

      /**
       * The legs are marked too, so a statement shows what came back rather than
       * a payout that still looks successful next to a settlement that says
       * otherwise.
       */
      await PayoutLeg.updateMany(
        { _id: { $in: paidLegs.map((l) => l._id) } },
        { $set: { status: PAYOUT_LEG_STATUS.REVERSED, failureReason: reason.slice(0, 500) } },
      );
    },
  });

  return { ...present(moved), released, reversedLegs: paidLegs.length };
};
