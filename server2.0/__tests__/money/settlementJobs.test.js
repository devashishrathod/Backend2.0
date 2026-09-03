const mongoose = require("mongoose");

/**
 * `notify` is the seam, not the notice helpers.
 *
 * Mocking the helpers would let a job pass while calling a notice that does not
 * exist; mocking `notify` runs every line of the notice — the title, the money
 * formatting, the deep link — and only stops at the point where a push would
 * actually leave the process. That is what caught `undefined810.00` and
 * `deepLink(undefined)` on the refund side.
 */
const mockNotify = jest.fn(async () => ({ delivered: true }));
jest.mock("../../helpers/notifications/notify", () => ({
  notify: (...args) => mockNotify(...args),
  resolveRecipient: jest.fn(),
}));

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const Settlement = require("../../models/Settlement");
const SettlementHistory = require("../../models/SettlementHistory");
const PayoutLeg = require("../../models/PayoutLeg");
const LedgerEntry = require("../../models/LedgerEntry");
const Setting = require("../../models/Setting");
const {
  buildSettlements,
  sweepStalePayouts,
  alertLateSettlements,
  reconcileSettlementLedger,
  sweepAbandonedDrafts,
} = require("../../services/settlements");
const { getJobRegistry } = require("../../jobs");
const { SETTLEMENT_STATUS } = require("../../constants/settlement");
const { PAYOUT_TYPE, PAYOUT_LEG_STATUS } = require("../../constants/payout");
const {
  LEDGER_ENTRY_TYPE,
  LEDGER_ACCOUNT,
  LEDGER_DIRECTION,
} = require("../../constants/ledger");
const { NOTIFICATION_TYPES } = require("../../constants/notification");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");
const { PAYMENT_STATUS } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(Date.now() - ms);

let BRAND;
let seq = 0;

const typesSent = () =>
  mockNotify.mock.calls.map(([args]) => args.type).filter(Boolean);

const settlement = (overrides = {}) => {
  seq += 1;
  return Settlement.create({
    brandId: BRAND,
    periodStart: ago(2 * DAY),
    periodEnd: ago(DAY),
    idempotencyKey: `STL:${BRAND}:${seq}:${Math.random()}`,
    settlementNumber: `STL-2026-${String(seq).padStart(5, "0")}`,
    status: SETTLEMENT_STATUS.PENDING_APPROVAL,
    netPayable: 823,
    grossCollected: 1000,
    transactionCount: 1,
    bankSnapshot: {
      accountHolderName: "Cafe Mocha",
      maskedAccountNumber: "XXXXXX7890",
      accountLast4Digits: "7890",
      ifscCode: "HDFC0001234",
      bankName: "HDFC Bank",
      bankId: oid(),
      verifiedAt: new Date(),
    },
    ...overrides,
  });
};

const leg = (settlementDoc, overrides = {}) =>
  PayoutLeg.create({
    payoutType: PAYOUT_TYPE.SETTLEMENT,
    settlementId: settlementDoc._id,
    brandId: settlementDoc.brandId,
    legNumber: 1,
    amount: settlementDoc.netPayable,
    status: PAYOUT_LEG_STATUS.INITIATED,
    initiatedAt: new Date(),
    ...overrides,
  });

const payoutEntry = (settlementDoc, legDoc, amount) =>
  LedgerEntry.create({
    entryType: LEDGER_ENTRY_TYPE.PAYOUT,
    account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
    direction: LEDGER_DIRECTION.DEBIT,
    amount,
    settlementId: settlementDoc._id,
    payoutLegId: legDoc?._id,
    brandId: settlementDoc.brandId,
    occurredAt: new Date(),
    narration: "test payout",
  });

const payment = (overrides = {}) =>
  Transaction.create({
    purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
    gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
    customerId: oid(),
    brandId: BRAND,
    amount: 810,
    paidAmount: 810,
    status: PAYMENT_STATUS.CAPTURED,
    verified: true,
    verifiedAt: ago(3 * DAY),
    fundsReceivedAt: ago(2 * DAY),
    settlementHold: false,
    amountRefunded: 0,
    invoiceId: `TD/VCH/26-27/${Math.floor(Math.random() * 1e6)}`,
    voucher: { netBill: 800, vendorPayable: 800 },
    ...overrides,
  });

beforeAll(async () => {
  await connectTestDb();
  for (const m of [Transaction, Settlement, PayoutLeg, LedgerEntry]) {
    await m.createIndexes();
  }
});

afterAll(async () => {
  await clearCollections(
    Transaction,
    Settlement,
    SettlementHistory,
    PayoutLeg,
    LedgerEntry,
    Setting,
  );
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(
    Transaction,
    Settlement,
    SettlementHistory,
    PayoutLeg,
    LedgerEntry,
    Setting,
  );
  BRAND = oid();
  mockNotify.mockClear();
});

/**
 * A bare `setInterval` outside the registry runs once per instance on a
 * multi-instance deploy — and these decide that money is missing, or build the
 * record of what we owe. The registry is what gives them the cross-process
 * `JobLock` and the health record.
 */
describe("the registry", () => {
  it("registers every settlement sweep", () => {
    const names = getJobRegistry().map((job) => job.name);

    for (const name of [
      "buildSettlements",
      "sweepStalePayouts",
      "alertLateSettlements",
      "reconcileSettlementLedger",
      "sweepAbandonedDrafts",
    ]) {
      expect(names).toContain(name);
    }
  });

  /**
   * ⚠️ The build is registered **directly**, with no wrapper.
   *
   * A wrapper existed briefly and re-read `settlement.isEnabled` before
   * delegating — a second copy of a policy `buildSettlements` already enforces,
   * returning its own `{skipped: true}` on the same key the real return uses for
   * a *count*. Two copies of one policy is how the two drift.
   */
  it("registers the build itself, not a wrapper around it", () => {
    const {
      buildSettlements: registered,
    } = require("../../services/settlements");

    expect(registered).toBe(buildSettlements);
  });
});

describe("building on a schedule", () => {
  it("does nothing at all when payouts are switched off", async () => {
    await Setting.create({
      customer: { settlement: { isEnabled: false } },
    });
    await payment();

    const result = await buildSettlements();

    expect(result.skipped).toBe(true);
    expect(await Settlement.countDocuments({})).toBe(0);
  });

  /**
   * Not silence — "off" and "broken" look identical in a log that says nothing,
   * and which of the two it is decides whether anyone should be woken up.
   */
  it("says why it skipped rather than reporting a quiet success", async () => {
    await Setting.create({ customer: { settlement: { isEnabled: false } } });

    const result = await buildSettlements();

    expect(result.reason).toEqual(expect.any(String));
    expect(result.reason).not.toHaveLength(0);
  });

  it("builds when payouts are on", async () => {
    await payment();

    const result = await buildSettlements();

    expect(result.built).toBeGreaterThan(0);
    expect(await Settlement.countDocuments({})).toBeGreaterThan(0);
  });

  /**
   * ⚠️ `skipped` carries two meanings on the same key: `true` when payouts are
   * switched off, and a **count** of brands whose settlement already existed on
   * a normal run. `if (result.skipped)` is therefore true for both.
   *
   * Pinned here so the two shapes stay distinguishable by something — the
   * disabled return has a `reason` and no `built`; the normal one has `built`
   * and `periodEnd`.
   */
  it("keeps the two return shapes tellable apart", async () => {
    await payment();
    const ran = await buildSettlements();

    expect(ran.built).toBeDefined();
    expect(ran.periodEnd).toBeDefined();
    expect(ran.reason).toBeUndefined();

    await Setting.deleteMany({});
    await Setting.create({ customer: { settlement: { isEnabled: false } } });
    const off = await buildSettlements();

    expect(off.skipped).toBe(true);
    expect(off.built).toBeUndefined();
    expect(off.reason).toEqual(expect.any(String));
  });

  /**
   * Hourly, not nightly. A second run inside the same period must build nothing
   * — that idempotency is what lets a night the process was down heal itself on
   * the next tick instead of skipping a brand's day.
   */
  it("builds nothing the second time in the same period", async () => {
    await payment();

    await buildSettlements();
    const afterFirst = await Settlement.countDocuments({});
    await buildSettlements();

    expect(await Settlement.countDocuments({})).toBe(afterFirst);
  });
});

describe("a payout that left and was never confirmed", () => {
  it("alerts on a leg that has been in flight too long", async () => {
    const s = await settlement({ status: SETTLEMENT_STATUS.PROCESSING });
    await leg(s, { initiatedAt: ago(8 * HOUR) });

    const result = await sweepStalePayouts({ staleHours: 6 });

    expect(result.alerted).toBe(1);
    expect(typesSent()).toContain(NOTIFICATION_TYPES.SETTLEMENT_STUCK);
  });

  /**
   * ⚠️ The whole point of this job. A `MANUAL_BANK` NEFT has no recall: if the
   * sweep auto-failed the settlement, it would write "the bank rejected it" over
   * a transfer that succeeded, release the rows into the next cycle, and pay the
   * vendor a second time.
   */
  it("changes nothing — it alerts and stops", async () => {
    const s = await settlement({ status: SETTLEMENT_STATUS.PROCESSING });
    const l = await leg(s, { initiatedAt: ago(8 * HOUR) });

    await sweepStalePayouts({ staleHours: 6 });

    expect((await Settlement.findById(s._id)).status).toBe(
      SETTLEMENT_STATUS.PROCESSING,
    );
    expect((await PayoutLeg.findById(l._id)).status).toBe(
      PAYOUT_LEG_STATUS.INITIATED,
    );
  });

  it("leaves a leg that has only just been started", async () => {
    const s = await settlement({ status: SETTLEMENT_STATUS.PROCESSING });
    await leg(s, { initiatedAt: ago(HOUR) });

    const result = await sweepStalePayouts({ staleHours: 6 });

    expect(result.alerted).toBe(0);
  });

  /**
   * A leg from a payout that was failed or reversed is kept on purpose, so the
   * record holds both attempts. It is not stuck; its settlement moved on.
   */
  it("ignores an old leg whose settlement has already moved on", async () => {
    const s = await settlement({ status: SETTLEMENT_STATUS.FAILED });
    await leg(s, { initiatedAt: ago(48 * HOUR) });

    const result = await sweepStalePayouts({ staleHours: 6 });

    expect(result.alerted).toBe(0);
    expect(typesSent()).not.toContain(NOTIFICATION_TYPES.SETTLEMENT_STUCK);
  });

  it("ignores a leg that was confirmed", async () => {
    const s = await settlement({ status: SETTLEMENT_STATUS.PROCESSING });
    await leg(s, {
      initiatedAt: ago(48 * HOUR),
      status: PAYOUT_LEG_STATUS.PAID,
      utr: "UTR123456",
      paidAt: new Date(),
    });

    const result = await sweepStalePayouts({ staleHours: 6 });

    expect(result.alerted).toBe(0);
  });

  /**
   * A retry opens a **new** leg, and a second leg going quiet is a second thing
   * to look at — not a repeat of the first.
   */
  it("keys the alert on the leg, so a retry can alert again", async () => {
    const s = await settlement({ status: SETTLEMENT_STATUS.PROCESSING });
    const first = await leg(s, {
      legNumber: 1,
      initiatedAt: ago(8 * HOUR),
      status: PAYOUT_LEG_STATUS.FAILED,
    });
    const second = await leg(s, { legNumber: 2, initiatedAt: ago(8 * HOUR) });

    await sweepStalePayouts({ staleHours: 6 });

    const keys = mockNotify.mock.calls.map(([a]) => a.dedupeKey);
    expect(keys).toContain(`SETTLEMENT_STUCK:${second._id}`);
    expect(keys).not.toContain(`SETTLEMENT_STUCK:${first._id}`);
  });
});

describe("money owed for longer than we promised", () => {
  it("alerts on a settlement sitting past the window", async () => {
    await settlement({ createdAt: ago(120 * HOUR) });

    const result = await alertLateSettlements();

    expect(result.alerted).toBe(1);
    expect(typesSent()).toContain(NOTIFICATION_TYPES.SETTLEMENT_LATE);
  });

  /**
   * The bug the refund reminders shipped once: a second pass re-read the row the
   * first had just bumped and fired the same alert a millisecond later, which
   * reads as a broken system rather than a helpful one.
   */
  it("sends exactly one alert, however many times it runs", async () => {
    await settlement({ createdAt: ago(120 * HOUR) });

    await alertLateSettlements();
    await alertLateSettlements();
    await alertLateSettlements();

    expect(
      typesSent().filter((t) => t === NOTIFICATION_TYPES.SETTLEMENT_LATE),
    ).toHaveLength(1);
  });

  it("leaves a settlement that is still inside the window", async () => {
    await settlement({ createdAt: ago(2 * HOUR) });

    const result = await alertLateSettlements();

    expect(result.alerted).toBe(0);
  });

  /**
   * A bounce nobody retried is exactly as unpaid as one that was never sent —
   * and the most likely to be forgotten, because it already had its moment of
   * attention.
   */
  it("counts a failed payout as unpaid money", async () => {
    await settlement({
      status: SETTLEMENT_STATUS.FAILED,
      createdAt: ago(120 * HOUR),
    });

    const result = await alertLateSettlements();

    expect(result.alerted).toBe(1);
  });

  it("counts a hold nobody revisited", async () => {
    await settlement({
      status: SETTLEMENT_STATUS.ON_HOLD,
      createdAt: ago(120 * HOUR),
    });

    const result = await alertLateSettlements();

    expect(result.alerted).toBe(1);
  });

  it("says nothing about a settlement that was already paid", async () => {
    await settlement({
      status: SETTLEMENT_STATUS.PAID,
      createdAt: ago(120 * HOUR),
    });

    const result = await alertLateSettlements();

    expect(result.alerted).toBe(0);
  });

  /**
   * A carried-forward day owes nobody anything — its rows flowed into the next
   * cycle. Alerting on it would train an admin to dismiss this notice.
   */
  it("says nothing about a settlement with nothing to pay", async () => {
    await settlement({
      status: SETTLEMENT_STATUS.CARRIED_FORWARD,
      netPayable: 0,
      createdAt: ago(120 * HOUR),
    });

    const result = await alertLateSettlements();

    expect(result.alerted).toBe(0);
  });

  it("honours the admin's own window", async () => {
    await Setting.create({
      customer: { settlement: { notReceivedAlertHours: 12 } },
    });
    await settlement({ createdAt: ago(24 * HOUR) });

    const result = await alertLateSettlements();

    expect(result.alerted).toBe(1);
  });
});

describe("do the books and the bank transfers agree", () => {
  it("stays quiet when every leg is booked", async () => {
    const s = await settlement({ status: SETTLEMENT_STATUS.PAID });
    const l = await leg(s, {
      status: PAYOUT_LEG_STATUS.PAID,
      utr: "UTR1",
      paidAt: new Date(),
    });
    await payoutEntry(s, l, s.netPayable);

    const result = await reconcileSettlementLedger();

    expect(result.drifted).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  /**
   * A leg with no entry means the books claim we still hold money that has
   * already gone — our liabilities understated, and nothing anywhere errors.
   */
  it("shouts when money left and nothing was booked", async () => {
    const s = await settlement({ status: SETTLEMENT_STATUS.PAID });
    await leg(s, {
      status: PAYOUT_LEG_STATUS.PAID,
      utr: "UTR1",
      paidAt: new Date(),
    });

    const result = await reconcileSettlementLedger();

    expect(result.drifted).toBe(1);
    expect(typesSent()).toContain(NOTIFICATION_TYPES.SETTLEMENT_LEDGER_DRIFT);
  });

  /** The other direction: booked money that no transfer carried. */
  it("shouts when the books claim a payout that never left", async () => {
    const s = await settlement({ status: SETTLEMENT_STATUS.PAID });
    await payoutEntry(s, null, s.netPayable);

    const result = await reconcileSettlementLedger();

    expect(result.drifted).toBe(1);
  });

  it("names the gap so an admin knows which way it is out", async () => {
    const s = await settlement({ status: SETTLEMENT_STATUS.PAID });
    const l = await leg(s, {
      status: PAYOUT_LEG_STATUS.PAID,
      utr: "UTR1",
      paidAt: new Date(),
    });
    // Half the payout was booked.
    await payoutEntry(s, l, 400);

    await reconcileSettlementLedger();

    const [args] = mockNotify.mock.calls[0];
    expect(args.meta.legTotal).toBe(823);
    expect(args.meta.ledgerTotal).toBe(400);
    expect(args.meta.gap).toBe(423);
  });

  it("does not treat a rounding remainder as drift", async () => {
    const s = await settlement({
      status: SETTLEMENT_STATUS.PAID,
      netPayable: 823.33,
    });
    const l = await leg(s, {
      amount: 823.33,
      status: PAYOUT_LEG_STATUS.PAID,
      utr: "UTR1",
      paidAt: new Date(),
    });
    await payoutEntry(s, l, 823.331);

    const result = await reconcileSettlementLedger();

    expect(result.drifted).toBe(0);
  });

  /**
   * ⚠️ A reversed settlement keeps its `PAYOUT` entries — the ledger corrects by
   * adding a `PAYOUT_REVERSAL` row, never by editing one — while its legs go to
   * `REVERSED`. Read naively that is a full-payout gap on every reversal, which
   * would fire a CRITICAL alert on a perfectly correct set of books.
   *
   * It never reaches here, and this pins the reason: the outer query is
   * `status: PAID`, and a reversal moves the settlement off `PAID`.
   */
  it("does not read a reversal as drift", async () => {
    const s = await settlement({ status: SETTLEMENT_STATUS.REVERSED });
    const l = await leg(s, {
      status: PAYOUT_LEG_STATUS.REVERSED,
      utr: "UTR1",
      paidAt: new Date(),
    });
    // The original payout entry stays; a PAYOUT_REVERSAL sits beside it.
    await payoutEntry(s, l, s.netPayable);

    const result = await reconcileSettlementLedger();

    expect(result.checked).toBe(0);
    expect(result.drifted).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  /**
   * `RESERVE_HOLD` carries a `settlementId` too, but it moved no money out of
   * our account — counting it would report drift on every settlement that held
   * a reserve.
   */
  it("counts only PAYOUT entries, not the reserve held beside them", async () => {
    const s = await settlement({
      status: SETTLEMENT_STATUS.PAID,
      reserveHeld: 100,
    });
    const l = await leg(s, {
      status: PAYOUT_LEG_STATUS.PAID,
      utr: "UTR1",
      paidAt: new Date(),
    });
    await payoutEntry(s, l, s.netPayable);
    await LedgerEntry.create({
      entryType: LEDGER_ENTRY_TYPE.RESERVE_HOLD,
      account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
      direction: LEDGER_DIRECTION.CREDIT,
      amount: 100,
      settlementId: s._id,
      payoutLegId: l._id,
      brandId: s.brandId,
      occurredAt: new Date(),
      narration: "test reserve",
    });

    const result = await reconcileSettlementLedger();

    expect(result.drifted).toBe(0);
  });

  /**
   * Read-only, and that is a design decision rather than an oversight: a ledger
   * row is never updated and never deleted, so a sweep that could post its own
   * entries would be a second, unguarded path to the books changing.
   */
  it("writes no ledger entry of its own", async () => {
    const s = await settlement({ status: SETTLEMENT_STATUS.PAID });
    await leg(s, {
      status: PAYOUT_LEG_STATUS.PAID,
      utr: "UTR1",
      paidAt: new Date(),
    });

    await reconcileSettlementLedger();

    expect(await LedgerEntry.countDocuments({})).toBe(0);
  });

  it("ignores a settlement that was never paid", async () => {
    await settlement({ status: SETTLEMENT_STATUS.APPROVED });

    const result = await reconcileSettlementLedger();

    expect(result.checked).toBe(0);
  });
});

describe("a build that died half-way", () => {
  /**
   * The shell is written before the rows are claimed. A crash in between leaves
   * an empty `DRAFT` whose `idempotencyKey` still occupies the period — so the
   * next build skips that brand's day, for ever, and the rows sit eligible and
   * unsettled with nothing raising.
   */
  it("abandons an empty draft and frees the period", async () => {
    const s = await settlement({
      status: SETTLEMENT_STATUS.DRAFT,
      createdAt: ago(6 * HOUR),
    });

    const result = await sweepAbandonedDrafts({ staleHours: 3 });

    expect(result.abandoned).toBe(1);
    const after = await Settlement.findById(s._id).lean();
    expect(after.status).toBe(SETTLEMENT_STATUS.CANCELLED);
    expect(after.idempotencyKey).toBe(`STL:VOID:${s._id}`);
    expect(after.isOpen).toBe(false);
  });

  /**
   * Through `transitionSettlement`, not a direct write — so the audit trail
   * shows what happened, and that nobody did it.
   */
  it("leaves a history row saying the sweep did it", async () => {
    const s = await settlement({
      status: SETTLEMENT_STATUS.DRAFT,
      createdAt: ago(6 * HOUR),
    });

    await sweepAbandonedDrafts({ staleHours: 3 });

    const history = await SettlementHistory.findOne({
      settlementId: s._id,
    }).lean();
    expect(history.toStatus).toBe(SETTLEMENT_STATUS.CANCELLED);
    expect(history.performedByRole).toBe("SYSTEM");
    expect(history.reason).toMatch(/Empty draft abandoned/);
  });

  it("lets the next build take the period it freed", async () => {
    await payment();
    const s = await settlement({
      status: SETTLEMENT_STATUS.DRAFT,
      createdAt: ago(6 * HOUR),
    });

    await sweepAbandonedDrafts({ staleHours: 3 });
    const result = await buildSettlements();

    // A fresh settlement, not the cancelled shell.
    expect(result.built).toBe(1);
    expect(
      await Settlement.countDocuments({
        brandId: BRAND,
        status: SETTLEMENT_STATUS.PENDING_APPROVAL,
      }),
    ).toBe(1);
    // And the dead one kept its voided key rather than blocking the period.
    expect((await Settlement.findById(s._id).lean()).idempotencyKey).toBe(
      `STL:VOID:${s._id}`,
    );
  });

  /**
   * ⚠️ Only an **empty** draft. A draft holding rows is a half-finished build,
   * and voiding its key here would strand those rows claimed by a settlement
   * nothing will ever pay — releasing them is `transitionSettlement`'s job and
   * nothing else's.
   */
  it("also sweeps a draft that is holding rows", async () => {
    const s = await settlement({
      status: SETTLEMENT_STATUS.DRAFT,
      createdAt: ago(6 * HOUR),
    });
    await payment({ settlementId: s._id });

    const result = await sweepAbandonedDrafts({ staleHours: 3 });

    /**
     * ⚠️ This assertion used to be `abandoned: 0` — the sweep skipped any draft
     * holding rows, reasoning that voiding it would strand them.
     *
     * Skipping stranded them anyway, and worse: `buildSettlements` claims rows
     * and *then* writes totals, so a crash in between leaves exactly this. No
     * other sweep looked at it and no build would revisit it, because its
     * `idempotencyKey` still owned the period. Permanent and silent — the crash
     * this job exists for, left unhandled by this job.
     *
     * `CANCELLED` goes through `transitionSettlement`, which releases the rows
     * on the way out, so they land back in the next cycle where they belong.
     */
    expect(result.abandoned).toBe(1);
    expect((await Settlement.findById(s._id)).status).toBe(
      SETTLEMENT_STATUS.CANCELLED,
    );
    // Released, not stranded.
    expect(await Transaction.countDocuments({ settlementId: s._id })).toBe(0);
  });

  it("leaves a draft the current build is still working on", async () => {
    await settlement({ status: SETTLEMENT_STATUS.DRAFT });

    const result = await sweepAbandonedDrafts({ staleHours: 3 });

    expect(result.abandoned).toBe(0);
  });

  it("does not touch a settlement that got past DRAFT", async () => {
    const s = await settlement({
      status: SETTLEMENT_STATUS.PENDING_APPROVAL,
      createdAt: ago(48 * HOUR),
    });

    await sweepAbandonedDrafts({ staleHours: 3 });

    expect((await Settlement.findById(s._id)).status).toBe(
      SETTLEMENT_STATUS.PENDING_APPROVAL,
    );
  });
});
