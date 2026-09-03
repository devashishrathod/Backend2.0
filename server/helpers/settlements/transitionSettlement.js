const crypto = require("node:crypto");
const Settlement = require("../../models/Settlement");
const { throwError } = require("../../utils");
const {
  SETTLEMENT_STATUS,
  ALLOWED_SETTLEMENT_TRANSITIONS,
  SETTLEMENT_RELEASING_STATUSES,
  SETTLEMENT_OPEN_STATUSES,
  SETTLEMENT_ACTOR,
} = require("../../constants/settlement");
const { releaseSettlementClaims } = require("./settlementClaims");

const readable = (status) => String(status).toLowerCase().replace(/_/g, " ");

/**
 * The **only** way a settlement's status changes.
 *
 * ### Why this is a function and not four `updateOne` calls
 *
 * Every edge in this state machine carries three side effects, and all three are
 * the kind a call site forgets:
 *
 * | Side effect | What forgetting it costs |
 * |---|---|
 * | **release** the claimed rows | those payments become invisible to every future cycle, for ever, with no error |
 * | ledger reversal on `PAID → REVERSED` | the books say money went out that came back, or vice versa |
 * | a history row | nobody can answer *"why was this payout late?"* |
 *
 * The first is the dangerous one. The claim lock only points one way —
 * `settlementId: null → S` — and every cycle's predicate asks for `null`. A
 * settlement cancelled with a plain `updateOne` strands its rows silently: no
 * error, no alert, the predicate just stops matching. The ledger stays quiet too,
 * because its arithmetic is *correct*; the money is still owed, it simply cannot
 * be reached.
 *
 * So release is not something a caller does after transitioning. It **is** the
 * transition.
 *
 * ### The write is conditional
 *
 * `status` is in the filter, so two admins clicking approve produce one approval
 * and one 409 — not two payouts.
 *
 * @param {object}   options
 * @param {object}   options.settlement  the current document (lean is fine)
 * @param {string}   options.to          target status
 * @param {object}   [options.actor]     who did it; a job has none
 * @param {string}   [options.reason]    recorded on the history row
 * @param {object}   [options.set]       extra fields to write in the same update
 * @param {Function} [options.beforeRelease]  runs after the status write and
 *   **before** the rows are released — this is where a `PAYOUT_REVERSAL` ledger
 *   entry goes, so a crash leaves an over-stated reversal rather than money that
 *   is both paid and claimable
 */
exports.transitionSettlement = async ({
  settlement,
  to,
  actor = {},
  reason,
  set = {},
  beforeRelease,
}) => {
  if (!settlement?._id) throwError(500, "No settlement to transition.");

  const from = settlement.status;
  const allowed = ALLOWED_SETTLEMENT_TRANSITIONS[from] || [];

  if (!allowed.includes(to)) {
    /**
     * Names both ends and what *is* possible. "Invalid transition" leaves an
     * admin with nothing to do; this tells them where the settlement actually is.
     */
    throwError(
      422,
      allowed.length
        ? `A ${readable(from)} settlement cannot become ${readable(to)}. ` +
            `It can only go to: ${allowed.map(readable).join(", ")}.`
        : `A ${readable(from)} settlement is final and cannot change.`,
    );
  }

  /**
   * The conditional claim. Two admins on the same screen produce one winner.
   *
   * `isOpen` is set here as well as by the pre-save hook, because this is an
   * update rather than a document save — the hook does not run.
   */
  /**
   * The statement link is minted the moment a settlement becomes `PAID`.
   *
   * ⚠️ Here, and not in `confirmPayout`, because `PAID` is reached from **two**
   * places — the normal final leg, and the self-heal for a confirmation that
   * crashed after its leg was already paid. Minting at one of them would leave
   * the other with a settlement nobody can download a statement for, and that
   * gap would only surface as a vendor asking where their paperwork is.
   *
   * `$setOnInsert` is not available on an update, so the guard is the `||` — a
   * settlement that already has a token keeps it, so a re-run cannot invalidate
   * a link already sitting in somebody's inbox.
   */
  const becomingPaid = to === SETTLEMENT_STATUS.PAID;
  const mintStatementToken = becomingPaid && !settlement.statementToken;

  /**
   * ⚠️ Stamped here for the same reason the token is: `PAID` is reached from two
   * places, and the reserve's hold clock runs from this field. A settlement that
   * became paid through the self-heal path with no `paidAt` would have a reserve
   * that never matures — held for ever, silently.
   *
   * `||` so a re-entry cannot move the date on a settlement that was already
   * paid, which would quietly restart every reserve behind it.
   */
  const stampPaidAt = becomingPaid && !settlement.paidAt;

  const updated = await Settlement.findOneAndUpdate(
    { _id: settlement._id, status: from },
    {
      $set: {
        ...set,
        status: to,
        isOpen: SETTLEMENT_OPEN_STATUSES.includes(to),
        ...(mintStatementToken
          ? { statementToken: crypto.randomBytes(32).toString("hex") }
          : {}),
        ...(stampPaidAt ? { paidAt: new Date() } : {}),
      },
    },
    { returnDocument: "after" },
  ).lean();

  if (!updated) {
    // Somebody moved it first. Re-read so the message names where it went.
    const current = await Settlement.findById(settlement._id)
      .select("status")
      .lean();
    throwError(
      409,
      `This settlement was already moved to ${readable(current?.status || "another state")}.`,
    );
  }

  /**
   * Ledger first, rows second — the order is the point.
   *
   * A crash between them leaves a reversal entry with the rows still claimed:
   * over-stated, visible, and fixable. The other order leaves rows released with
   * no reversal booked, which reads as money that was never paid and is free to
   * be settled again.
   */
  if (typeof beforeRelease === "function") {
    await beforeRelease(updated);
  }

  let released = null;
  if (SETTLEMENT_RELEASING_STATUSES.includes(to)) {
    released = await releaseSettlementClaims(updated._id);
  }

  await recordHistory({ settlement: updated, from, to, actor, reason, released });

  return { settlement: updated, released };
};

/**
 * Append-only, and failure-tolerant.
 *
 * A lost history row must never roll back a transition that has already moved
 * money or released rows. The same trade `recordClaimHistory` makes.
 */
const recordHistory = async ({ settlement, from, to, actor, reason, released }) => {
  try {
    const SettlementHistory = require("../../models/SettlementHistory");
    await SettlementHistory.create({
      settlementId: settlement._id,
      brandId: settlement.brandId,
      settlementNumber: settlement.settlementNumber,
      fromStatus: from,
      toStatus: to,
      performedBy: actor.userId,
      performedByRole: actor.role ? SETTLEMENT_ACTOR.ADMIN : SETTLEMENT_ACTOR.SYSTEM,
      reason,
      amount: settlement.netPayable,
      snapshot: {
        released,
        needsRevalidation: settlement.needsRevalidation,
        attemptCount: settlement.attemptCount,
      },
    });
  } catch (error) {
    console.error(
      `[transitionSettlement] history row lost for ${settlement._id} (${from} → ${to}):`,
      error?.message,
    );
  }
};

exports.SETTLEMENT_STATUS = SETTLEMENT_STATUS;
