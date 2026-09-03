const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const RefundRequest = require("../../models/RefundRequest");
const Settlement = require("../../models/Settlement");
const SettlementHistory = require("../../models/SettlementHistory");
const {
  claimTransactions,
  claimRefundAdjustments,
  releaseSettlementClaims,
  countClaimedRows,
  transitionSettlement,
} = require("../../helpers/settlements");
const {
  SETTLEMENT_STATUS,
  SETTLEMENT_RELEASING_STATUSES,
  ALLOWED_SETTLEMENT_TRANSITIONS,
} = require("../../constants/settlement");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");
const { REFUND_REQUEST_STATUS, REFUND_REASON } = require("../../constants/refund");
const { PAYMENT_STATUS, ROLES } = require("../../constants");
const { settlementPeriodEnd } = require("../../helpers/dates");

const oid = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms);

let BRAND;
const PERIOD_END = new Date();
const FUNDS_BEFORE = new Date();

const payment = (overrides = {}) => ({
  purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
  gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
  customerId: oid(),
  brandId: BRAND,
  amount: 810,
  paidAmount: 810,
  status: PAYMENT_STATUS.CAPTURED,
  verified: true,
  verifiedAt: ago(5 * DAY),
  // Eligible by default: the gateway has settled it to us.
  fundsReceivedAt: ago(2 * DAY),
  settlementHold: false,
  amountRefunded: 0,
  voucher: { netBill: 800, vendorPayable: 800 },
  ...overrides,
});

const shell = async (overrides = {}) =>
  Settlement.create({
    brandId: BRAND,
    periodStart: ago(6 * DAY),
    periodEnd: PERIOD_END,
    idempotencyKey: `STL:${BRAND}:${Date.now()}:${Math.random()}`,
    ...overrides,
  });

const claim = (settlementId) =>
  claimTransactions({
    settlementId,
    brandId: BRAND,
    eligibleBefore: PERIOD_END,
    fundsReceivedBefore: FUNDS_BEFORE,
  });

beforeAll(async () => {
  await connectTestDb();
  for (const m of [Transaction, RefundRequest, Settlement, SettlementHistory]) {
    await m.createIndexes();
  }
});

afterAll(async () => {
  await clearCollections(Transaction, RefundRequest, Settlement, SettlementHistory);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(Transaction, RefundRequest, Settlement, SettlementHistory);
  BRAND = oid();
});

describe("what a settlement may take", () => {
  it("takes a captured payment the gateway has settled to us", async () => {
    await Transaction.create(payment());
    const s = await shell();

    const claimed = await claim(s._id);
    expect(claimed).toHaveLength(1);
  });

  /**
   * ⚠️ `verifiedAt` says the customer paid. Razorpay holds that money for its
   * own cycle first, so a T+N rule computed from `verifiedAt` is a *guess* that
   * the gateway will have settled by then. The times it is wrong — an account
   * under review, a batch held over a bank holiday — are exactly when paying it
   * out means funding the payout ourselves.
   */
  it("will not take money the gateway has not settled yet", async () => {
    await Transaction.create(payment({ fundsReceivedAt: null }));
    const s = await shell();

    expect(await claim(s._id)).toHaveLength(0);
  });

  /**
   * ⚠️ `settlementHold` carries ineligibility, not `isDisputed` — a chargeback
   * we **lost** correctly sets `isDisputed` back to `false`, and keying on that
   * would make the row we just lost look perfectly payable.
   */
  it("will not take a held payment, even one that is not currently disputed", async () => {
    await Transaction.create(
      payment({ settlementHold: true, isDisputed: false }),
    );
    const s = await shell();

    expect(await claim(s._id)).toHaveLength(0);
  });

  /**
   * ⚠️ This assertion used to be the other way round, and it cost the vendor
   * their whole sale.
   *
   * The filter was `amountRefunded: { $lte: 0 }`, so a partially refunded
   * payment was excluded — and that field is monotonic, so it was excluded from
   * **every** future cycle, silently. Meanwhile `claimRefundAdjustments` still
   * deducted the clawback for the refunded part from a later cycle. On an ₹810
   * payment with ₹300 back, the vendor was out roughly ₹1,100 on an ₹800 sale.
   *
   * The original intent was right — do not pay the vendor for the whole sale
   * when part of it went back — but exclusion was the wrong instrument. The row
   * is claimed at full value now and the refund is claimed beside it, so
   * `computeTotals` subtracts exactly the clawback.
   */
  it("claims a partially refunded payment, so the remainder can be paid", async () => {
    await Transaction.create(
      payment({ amountRefunded: 300, isRefunded: false }),
    );
    const s = await shell();

    expect(await claim(s._id)).toHaveLength(1);
  });

  /**
   * A **fully** refunded payment is still excluded, and must be: the vendor was
   * never owed it. Its refund is left unclaimed too, so no clawback is taken
   * against sales they *were* paid for.
   */
  it("still refuses a fully refunded payment", async () => {
    await Transaction.create(
      payment({ amountRefunded: 810, isRefunded: true }),
    );
    const s = await shell();

    expect(await claim(s._id)).toHaveLength(0);
  });

  it("will not take another brand's payment", async () => {
    await Transaction.create(payment({ brandId: oid() }));
    const s = await shell();

    expect(await claim(s._id)).toHaveLength(0);
  });

  it("will not take a subscription payment", async () => {
    await Transaction.create({
      ...payment(),
      purpose: TRANSACTION_PURPOSE.SUBSCRIPTION,
      gatewayAccount: RAZORPAY_ACCOUNTS.VENDOR,
    });
    const s = await shell();

    expect(await claim(s._id)).toHaveLength(0);
  });

  it("will not take one captured after the period ended", async () => {
    await Transaction.create(payment({ verifiedAt: new Date(Date.now() + DAY) }));
    const s = await shell();

    expect(await claim(s._id)).toHaveLength(0);
  });
});

describe("the claim is the lock", () => {
  /**
   * ⚠️ The race this exists for.
   *
   * Select-then-write leaves a window in which a refund lands, and that payment
   * is counted in a settlement it should not be in **while** the refund is also
   * deducted. The same money moves twice.
   */
  it("lets only one of two concurrent builds take a row", async () => {
    await Transaction.create(payment());
    const [a, b] = await Promise.all([shell(), shell()]);

    const [claimedA, claimedB] = await Promise.all([claim(a._id), claim(b._id)]);

    const total = claimedA.length + claimedB.length;
    expect(total).toBe(1);
  });

  it("never lets a row belong to two settlements", async () => {
    await Transaction.create(payment());
    const first = await shell();
    await claim(first._id);

    const second = await shell();
    expect(await claim(second._id)).toHaveLength(0);
  });

  /**
   * ⚠️ A `refundAdjustment` computed live from "this brand's completed refunds"
   * would apply the **same deduction in every cycle** — one chargeback taken off
   * the vendor again and again, with each month's arithmetic looking internally
   * consistent.
   */
  it("locks refund adjustments the same way", async () => {
    /**
     * ⚠️ The payment carries a `settlementId` — it was paid out in an earlier
     * cycle. That is now part of the setup rather than incidental: a refund is
     * only claimable as a clawback if the vendor was actually paid for the sale.
     * A refund on a payment nobody ever settled is left alone, because deducting
     * it would take the money from sales they *were* paid for.
     */
    const txn = await Transaction.create(
      payment({ settlementId: (await shell())._id }),
    );
    const req = await RefundRequest.create({
      claimId: oid(),
      transactionId: txn._id,
      customerId: oid(),
      brandId: BRAND,
      claimCode: "TD-ACD349",
      requestedAmount: 810,
      reason: REFUND_REASON.NOT_HONOURED,
    });
    req.status = REFUND_REQUEST_STATUS.COMPLETED;
    await req.save();

    const first = await shell();
    expect(await claimRefundAdjustments({ settlementId: first._id, brandId: BRAND })).toHaveLength(1);

    // Next month must not deduct it again.
    const second = await shell();
    expect(await claimRefundAdjustments({ settlementId: second._id, brandId: BRAND })).toHaveLength(0);
  });
});

describe("release is the only way out", () => {
  /**
   * ⚠️ The failure this whole helper exists to prevent.
   *
   * The lock points one way, and every cycle's predicate asks for
   * `settlementId: null`. A settlement that leaves the happy path without
   * releasing makes its rows invisible to every future cycle, for ever — no
   * error, no alert, the predicate simply stops matching.
   */
  it("gives the rows back on CANCELLED", async () => {
    await Transaction.create(payment());
    const s = await shell({ status: SETTLEMENT_STATUS.PENDING_APPROVAL });
    await claim(s._id);

    expect((await countClaimedRows(s._id)).transactions).toBe(1);

    await transitionSettlement({
      settlement: await Settlement.findById(s._id).lean(),
      to: SETTLEMENT_STATUS.CANCELLED,
      actor: { role: ROLES.ADMIN, userId: oid() },
      reason: "Built from the wrong period",
    });

    expect((await countClaimedRows(s._id)).transactions).toBe(0);
    // And the row is claimable by the next cycle again.
    const next = await shell();
    expect(await claim(next._id)).toHaveLength(1);
  });

  it("gives them back on ABANDONED", async () => {
    await Transaction.create(payment());
    const s = await shell({ status: SETTLEMENT_STATUS.FAILED });
    await claim(s._id);

    await transitionSettlement({
      settlement: await Settlement.findById(s._id).lean(),
      to: SETTLEMENT_STATUS.ABANDONED,
      reason: "Bank account is closed; rebuilding next cycle",
    });

    expect((await countClaimedRows(s._id)).transactions).toBe(0);
  });

  /**
   * A bounce is an ordinary event, and the right operation is to fix the account
   * and retry the **same** settlement — keeping its number and its statement.
   * Releasing here would scatter its rows into the next cycle and lose both.
   */
  it("does NOT give them back on FAILED", async () => {
    await Transaction.create(payment());
    const s = await shell({ status: SETTLEMENT_STATUS.PROCESSING });
    await claim(s._id);

    await transitionSettlement({
      settlement: await Settlement.findById(s._id).lean(),
      to: SETTLEMENT_STATUS.FAILED,
      reason: "NEFT bounced",
    });

    expect((await countClaimedRows(s._id)).transactions).toBe(1);
  });

  /**
   * That money left. It comes back only through `REVERSED`, and only after the
   * ledger reversal — **ledger first, rows second**.
   */
  it("does NOT give them back on PAID", async () => {
    await Transaction.create(payment());
    const s = await shell({ status: SETTLEMENT_STATUS.PROCESSING });
    await claim(s._id);

    await transitionSettlement({
      settlement: await Settlement.findById(s._id).lean(),
      to: SETTLEMENT_STATUS.PAID,
    });

    expect((await countClaimedRows(s._id)).transactions).toBe(1);
  });

  it("runs the ledger reversal before releasing", async () => {
    await Transaction.create(payment());
    const s = await shell({ status: SETTLEMENT_STATUS.PAID });
    await claim(s._id);

    const order = [];
    await transitionSettlement({
      settlement: await Settlement.findById(s._id).lean(),
      to: SETTLEMENT_STATUS.REVERSED,
      reason: "Payout recalled by the bank",
      beforeRelease: async () => {
        // A crash here must leave an over-stated reversal, not money that is
        // both paid and claimable.
        order.push(`ledger:${(await countClaimedRows(s._id)).transactions}`);
      },
    });

    order.push(`after:${(await countClaimedRows(s._id)).transactions}`);
    expect(order).toEqual(["ledger:1", "after:0"]);
  });

  it("also gives back the refund adjustments it held", async () => {
    const txn = await Transaction.create(payment());
    const req = await RefundRequest.create({
      claimId: oid(),
      transactionId: txn._id,
      customerId: oid(),
      brandId: BRAND,
      claimCode: "TD-ACD349",
      requestedAmount: 810,
      reason: REFUND_REASON.NOT_HONOURED,
    });
    req.status = REFUND_REQUEST_STATUS.COMPLETED;
    await req.save();

    const s = await shell({ status: SETTLEMENT_STATUS.PENDING_APPROVAL });
    await claimRefundAdjustments({ settlementId: s._id, brandId: BRAND });

    await transitionSettlement({
      settlement: await Settlement.findById(s._id).lean(),
      to: SETTLEMENT_STATUS.CANCELLED,
    });

    // A release that forgot these would leave the deduction attached to a dead
    // settlement and silently forgiven.
    expect((await countClaimedRows(s._id)).refunds).toBe(0);
  });
});

describe("the state machine is enforced, not implied", () => {
  it("refuses a transition that does not exist", async () => {
    const s = await shell({ status: SETTLEMENT_STATUS.DRAFT });

    await expect(
      transitionSettlement({
        settlement: await Settlement.findById(s._id).lean(),
        to: SETTLEMENT_STATUS.PAID,
      }),
    ).rejects.toThrow(/cannot become paid/i);
  });

  /**
   * Derived from the machine rather than hard-coded.
   *
   * The first version spelled the list out — `/pending approval, cancelled/` —
   * and broke the moment `CARRIED_FORWARD` was added to `DRAFT`. That is a test
   * failing on a correct change, which teaches people to edit tests to make them
   * pass. What is worth asserting is that the message **names the real options**,
   * whatever they are.
   */
  it("names what is possible instead of just saying no", async () => {
    const s = await shell({ status: SETTLEMENT_STATUS.DRAFT });

    const error = await transitionSettlement({
      settlement: await Settlement.findById(s._id).lean(),
      to: SETTLEMENT_STATUS.PAID,
    }).catch((e) => e);

    for (const allowed of ALLOWED_SETTLEMENT_TRANSITIONS[SETTLEMENT_STATUS.DRAFT]) {
      expect(error.message.toLowerCase()).toContain(
        allowed.toLowerCase().replace(/_/g, " "),
      );
    }
  });

  it("says a terminal settlement is final", async () => {
    const s = await shell({ status: SETTLEMENT_STATUS.CANCELLED });

    await expect(
      transitionSettlement({
        settlement: await Settlement.findById(s._id).lean(),
        to: SETTLEMENT_STATUS.APPROVED,
      }),
    ).rejects.toThrow(/is final and cannot change/i);
  });

  /**
   * Two admins on the same screen produce one approval and one 409 — not two
   * payouts.
   */
  it("lets only one of two concurrent transitions land", async () => {
    const s = await shell({ status: SETTLEMENT_STATUS.PENDING_APPROVAL });
    const doc = await Settlement.findById(s._id).lean();

    const results = await Promise.allSettled([
      transitionSettlement({ settlement: doc, to: SETTLEMENT_STATUS.APPROVED }),
      transitionSettlement({ settlement: doc, to: SETTLEMENT_STATUS.ON_HOLD }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected");
    expect(lost.reason.message).toMatch(/already moved to/i);
  });

  it("writes a history row for every move", async () => {
    const s = await shell({ status: SETTLEMENT_STATUS.PENDING_APPROVAL });

    await transitionSettlement({
      settlement: await Settlement.findById(s._id).lean(),
      to: SETTLEMENT_STATUS.APPROVED,
      actor: { role: ROLES.ADMIN, userId: oid() },
      reason: "Checked against the statement",
    });

    const rows = await SettlementHistory.find({ settlementId: s._id }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].fromStatus).toBe(SETTLEMENT_STATUS.PENDING_APPROVAL);
    expect(rows[0].toStatus).toBe(SETTLEMENT_STATUS.APPROVED);
    expect(rows[0].reason).toMatch(/statement/i);
  });

  /**
   * A lost history row must never roll back a transition that has already
   * released rows or moved money.
   */
  it("still transitions when the history row cannot be written", async () => {
    const original = SettlementHistory.create;
    SettlementHistory.create = () => Promise.reject(new Error("disk on fire"));

    try {
      const s = await shell({ status: SETTLEMENT_STATUS.PENDING_APPROVAL });
      const { settlement } = await transitionSettlement({
        settlement: await Settlement.findById(s._id).lean(),
        to: SETTLEMENT_STATUS.APPROVED,
      });
      expect(settlement.status).toBe(SETTLEMENT_STATUS.APPROVED);
    } finally {
      SettlementHistory.create = original;
    }
  });

  it("keeps isOpen in step with the status", async () => {
    const s = await shell({ status: SETTLEMENT_STATUS.PENDING_APPROVAL });

    const { settlement } = await transitionSettlement({
      settlement: await Settlement.findById(s._id).lean(),
      to: SETTLEMENT_STATUS.CANCELLED,
    });

    // The sweep that finds settlements still holding rows keys on this.
    expect(settlement.isOpen).toBe(false);
  });
});

describe("the machine itself hangs together", () => {
  it("has no state that cannot be reached", () => {
    const all = Object.values(SETTLEMENT_STATUS);
    const reachable = new Set(Object.values(ALLOWED_SETTLEMENT_TRANSITIONS).flat());
    const orphans = all.filter(
      (s) => s !== SETTLEMENT_STATUS.DRAFT && !reachable.has(s),
    );

    expect(orphans).toEqual([]);
  });

  it("gives every state a transition list, even an empty one", () => {
    for (const status of Object.values(SETTLEMENT_STATUS)) {
      expect(ALLOWED_SETTLEMENT_TRANSITIONS[status]).toBeDefined();
    }
  });

  /**
   * ⚠️ If a releasing state were also open, the sweep would keep finding a
   * settlement that has already given its rows back — and a future change could
   * release them twice.
   */
  it("never marks a releasing state as still open", () => {
    const { SETTLEMENT_OPEN_STATUSES } = require("../../constants/settlement");
    for (const status of SETTLEMENT_RELEASING_STATUSES) {
      expect(SETTLEMENT_OPEN_STATUSES).not.toContain(status);
    }
  });

  it("does not release on PAID or FAILED", () => {
    expect(SETTLEMENT_RELEASING_STATUSES).not.toContain(SETTLEMENT_STATUS.PAID);
    expect(SETTLEMENT_RELEASING_STATUSES).not.toContain(SETTLEMENT_STATUS.FAILED);
  });
});

describe("one settlement per brand per period", () => {
  /**
   * ⚠️ `jobs/index.js` runs every job once at boot and the runner is
   * per-process, so a restart or a second instance means `buildSettlements` runs
   * again. This index — not the job's own care — is what stops it building the
   * same day twice.
   */
  it("refuses a second settlement with the same key", async () => {
    const key = `STL:${BRAND}:${settlementPeriodEnd(3).toISOString()}`;

    await Settlement.create({
      brandId: BRAND,
      periodStart: ago(4 * DAY),
      periodEnd: settlementPeriodEnd(3),
      idempotencyKey: key,
    });

    await expect(
      Settlement.create({
        brandId: BRAND,
        periodStart: ago(4 * DAY),
        periodEnd: settlementPeriodEnd(3),
        idempotencyKey: key,
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  /**
   * `$type: "string"`, not `sparse` — sparse indexes an explicit `null`, so
   * every DRAFT shell (none of which has a number yet) would collide with the
   * next on a rule that was never meant to apply to them.
   */
  it("lets many shells exist before any has a number", async () => {
    const shells = await Promise.all([shell(), shell(), shell()]);
    expect(shells.every((s) => !s.settlementNumber)).toBe(true);
  });
});
