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
const Setting = require("../../models/Setting");
const {
  approveSettlement,
  rebuildSettlement,
  cancelSettlement,
  holdSettlement,
} = require("../../services/settlements");
const { taintSettlement, claimTransactions } = require("../../helpers/settlements");
const { SETTLEMENT_STATUS } = require("../../constants/settlement");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");
const { PAYMENT_STATUS, ROLES } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms);

let BRAND;
const PERIOD_END = new Date();

const admin = () => ({ role: ROLES.ADMIN, userId: oid() });
const vendor = () => ({ role: ROLES.VENDOR, brandId: BRAND, userId: oid() });

const BANK = {
  accountHolderName: "Cafe Mocha",
  maskedAccountNumber: "XXXXXX7890",
  accountLast4Digits: "7890",
  ifscCode: "HDFC0001234",
  bankName: "HDFC Bank",
  bankId: oid(),
  verifiedAt: new Date(),
};

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
    verifiedAt: ago(5 * DAY),
    fundsReceivedAt: ago(2 * DAY),
    settlementHold: false,
    amountRefunded: 0,
    invoiceId: `TD/VCH/26-27/${Math.floor(Math.random() * 1e6)}`,
    voucher: { netBill: 800, vendorPayable: 800 },
    ...overrides,
  });

const settlement = async (overrides = {}) =>
  Settlement.create({
    brandId: BRAND,
    periodStart: ago(6 * DAY),
    periodEnd: PERIOD_END,
    idempotencyKey: `STL:${BRAND}:${Date.now()}:${Math.random()}`,
    status: SETTLEMENT_STATUS.PENDING_APPROVAL,
    bankSnapshot: BANK,
    netPayable: 800,
    grossCollected: 800,
    transactionCount: 1,
    ...overrides,
  });

/** A settlement that actually owns its rows, as the build leaves it. */
const built = async ({ payments = 1, ...overrides } = {}) => {
  for (let i = 0; i < payments; i += 1) await payment();
  const s = await settlement(overrides);
  const claimed = await claimTransactions({
    settlementId: s._id,
    brandId: BRAND,
    eligibleBefore: new Date(),
    fundsReceivedBefore: new Date(),
  });
  await Settlement.updateOne(
    { _id: s._id },
    { $set: { transactionCount: claimed.length, netPayable: claimed.length * 800 } },
  );
  return { settlement: await Settlement.findById(s._id).lean(), claimed };
};

beforeAll(async () => {
  await connectTestDb();
  for (const m of [Transaction, RefundRequest, Settlement, SettlementHistory]) {
    await m.createIndexes();
  }
});

afterAll(async () => {
  await clearCollections(
    Transaction,
    RefundRequest,
    Settlement,
    SettlementHistory,
    Setting,
  );
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(
    Transaction,
    RefundRequest,
    Settlement,
    SettlementHistory,
    Setting,
  );
  BRAND = oid();
});

describe("an admin signs it off", () => {
  it("approves a clean settlement", async () => {
    const { settlement: s } = await built();

    const result = await approveSettlement(admin(), s._id);

    expect(result.status).toBe(SETTLEMENT_STATUS.APPROVED);
    expect(result.bankLast4).toBe("7890");
  });

  it("records who approved it, and when", async () => {
    const { settlement: s } = await built();
    const who = admin();

    await approveSettlement(who, s._id);

    const after = await Settlement.findById(s._id).lean();
    expect(String(after.approvedBy)).toBe(String(who.userId));
    expect(after.approvedAt).toBeInstanceOf(Date);
  });

  it("writes a history row for the approval", async () => {
    const { settlement: s } = await built();
    await approveSettlement(admin(), s._id);

    const rows = await SettlementHistory.find({ settlementId: s._id }).lean();
    const row = rows.find((r) => r.toStatus === SETTLEMENT_STATUS.APPROVED);
    expect(row).toBeTruthy();
    expect(row.snapshot.bankLast4).toBe("7890");
  });

  it("refuses anyone who is not an admin", async () => {
    const { settlement: s } = await built();
    await expect(approveSettlement(vendor(), s._id)).rejects.toThrow(/only an admin/i);
  });

  it("refuses a settlement that is not awaiting approval", async () => {
    const { settlement: s } = await built({ status: SETTLEMENT_STATUS.DRAFT });
    await expect(approveSettlement(admin(), s._id)).rejects.toThrow(
      /is draft and cannot be approved/i,
    );
  });

  /**
   * ⚠️ `models/Bank.js` is a CGPEY penny-drop record, so a row can exist for an
   * account the drop failed on — `buildSettlements` only snapshots a verified
   * one. No snapshot means there is nothing safe to pay to, and NEFT has no
   * recall.
   */
  it("refuses to approve a payout with no verified account behind it", async () => {
    const { settlement: s } = await built({ bankSnapshot: undefined });

    await expect(approveSettlement(admin(), s._id)).rejects.toThrow(
      /no verified bank account/i,
    );
  });

  /**
   * Two admins on the same screen produce one approval and one 409 — not two
   * payouts.
   */
  it("lets only one of two concurrent approvals land", async () => {
    const { settlement: s } = await built();

    const results = await Promise.allSettled([
      approveSettlement(admin(), s._id),
      approveSettlement(admin(), s._id),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
});

describe("a risk event lands after the claim", () => {
  /**
   * ⚠️ The window this whole milestone exists for.
   *
   * `settlementHold` is only a **pre-claim** filter. Once `buildSettlements` has
   * stamped `settlementId`, setting the hold afterwards changes nothing about
   * that settlement — eligibility was evaluated at build time, and the totals
   * describe what was captured then.
   *
   * The build runs at 02:00 and the NEFT goes out at 14:00. That is twelve hours
   * in which a chargeback lands on a payment already inside the settlement.
   */
  it("flags the settlement a disputed payment is already inside", async () => {
    const { settlement: s, claimed } = await built();

    const result = await taintSettlement({
      transaction: claimed[0],
      reason: "Chargeback LOST",
    });

    expect(result.tainted).toBe(true);
    const after = await Settlement.findById(s._id).lean();
    expect(after.needsRevalidation).toBe(true);
    expect(after.taintedTransactionIds.map(String)).toContain(String(claimed[0]._id));
  });

  it("adds nothing twice on a redelivered webhook", async () => {
    const { settlement: s, claimed } = await built();

    await taintSettlement({ transaction: claimed[0], reason: "x" });
    await taintSettlement({ transaction: claimed[0], reason: "x" });

    const after = await Settlement.findById(s._id).lean();
    expect(after.taintedTransactionIds).toHaveLength(1);
  });

  /**
   * `PROCESSING` and beyond means the money is leaving or has left. A flag there
   * would be a lie — there is nothing left to exclude, and the answer is a
   * reversal or a clawback against the next cycle.
   */
  it("does not flag a settlement whose money is already moving", async () => {
    const { claimed } = await built({ status: SETTLEMENT_STATUS.PROCESSING });

    const result = await taintSettlement({ transaction: claimed[0], reason: "x" });
    expect(result.tainted).toBe(false);
  });

  it("does nothing for a payment in no settlement at all", async () => {
    const loose = await payment();
    const result = await taintSettlement({ transaction: loose, reason: "x" });
    expect(result.tainted).toBe(false);
  });
});

describe("approval is where the flag bites", () => {
  /**
   * ⚠️ The check lives **in the update filter**, not in an `if` above it. A read
   * that then writes leaves exactly the window it is trying to close: the flag
   * can land between the read and the write.
   */
  it("refuses a flagged settlement", async () => {
    const { settlement: s, claimed } = await built();
    await taintSettlement({ transaction: claimed[0], reason: "Chargeback" });

    await expect(approveSettlement(admin(), s._id)).rejects.toThrow(
      /no longer eligible/i,
    );
  });

  /**
   * The admin's next action depends on **which** payments went bad, so the
   * refusal names them instead of saying "revalidation required".
   */
  it("names the offending payments", async () => {
    const { settlement: s, claimed } = await built();
    await taintSettlement({ transaction: claimed[0], reason: "Chargeback" });

    await expect(approveSettlement(admin(), s._id)).rejects.toThrow(
      new RegExp(claimed[0].invoiceId.replace(/\//g, "\\/")),
    );
  });

  /**
   * Parked rather than left pending. A settlement that refuses approval but
   * stays in the approval queue invites the same click again, and the admin
   * learns to treat the error as noise.
   */
  it("puts it on hold rather than leaving it in the queue", async () => {
    const { settlement: s, claimed } = await built();
    await taintSettlement({ transaction: claimed[0], reason: "Chargeback" });

    await expect(approveSettlement(admin(), s._id)).rejects.toThrow();

    const after = await Settlement.findById(s._id).lean();
    expect(after.status).toBe(SETTLEMENT_STATUS.ON_HOLD);
  });

  it("keeps the rows claimed while it is on hold", async () => {
    const { settlement: s, claimed } = await built();
    await taintSettlement({ transaction: claimed[0], reason: "Chargeback" });
    await expect(approveSettlement(admin(), s._id)).rejects.toThrow();

    // Held, not released — the clean rows must not be taken by the next build
    // while an admin is deciding.
    const still = await Transaction.countDocuments({ settlementId: s._id });
    expect(still).toBe(1);
  });
});

describe("rebuilding without the rows that went bad", () => {
  it("drops the tainted rows and keeps the rest", async () => {
    const { settlement: s, claimed } = await built({ payments: 3 });
    await taintSettlement({ transaction: claimed[0], reason: "Chargeback" });
    await expect(approveSettlement(admin(), s._id)).rejects.toThrow();

    const result = await rebuildSettlement(admin(), s._id);

    expect(result.removed).toBe(1);
    expect(result.status).toBe(SETTLEMENT_STATUS.PENDING_APPROVAL);
    expect(result.transactionCount).toBe(2);
    expect(result.netPayable).toBe(1600);
  });

  /**
   * ⚠️ Only the tainted rows go back. Releasing everything and re-claiming would
   * look tidier and is wrong: between the release and the re-claim another build
   * could take those rows, and this settlement's number and statement would end
   * up describing a different set of payments than the one an admin approves.
   */
  it("leaves the clean rows claimed throughout", async () => {
    const { settlement: s, claimed } = await built({ payments: 3 });
    await taintSettlement({ transaction: claimed[0], reason: "Chargeback" });
    await expect(approveSettlement(admin(), s._id)).rejects.toThrow();

    await rebuildSettlement(admin(), s._id);

    const stillClaimed = await Transaction.countDocuments({ settlementId: s._id });
    expect(stillClaimed).toBe(2);
    // And the bad one is free for a future cycle, once its hold clears.
    const released = await Transaction.findById(claimed[0]._id).lean();
    expect(released.settlementId).toBeNull();
  });

  it("clears the flag so approval can go through", async () => {
    const { settlement: s, claimed } = await built({ payments: 2 });
    await taintSettlement({ transaction: claimed[0], reason: "Chargeback" });
    await expect(approveSettlement(admin(), s._id)).rejects.toThrow();

    await rebuildSettlement(admin(), s._id);
    const approved = await approveSettlement(admin(), s._id);

    expect(approved.status).toBe(SETTLEMENT_STATUS.APPROVED);
  });

  /**
   * A rebuild can empty a settlement out. `CARRIED_FORWARD` releases what is
   * left, and the release **is** the carry forward.
   */
  it("carries forward when nothing eligible is left", async () => {
    const { settlement: s, claimed } = await built({ payments: 1 });
    await taintSettlement({ transaction: claimed[0], reason: "Chargeback" });
    await expect(approveSettlement(admin(), s._id)).rejects.toThrow();

    const result = await rebuildSettlement(admin(), s._id);

    expect(result.status).toBe(SETTLEMENT_STATUS.CARRIED_FORWARD);
    expect(await Transaction.countDocuments({ settlementId: s._id })).toBe(0);
  });

  /** Guarded, so a rebuild cannot run against a settlement somebody is approving. */
  it("refuses to rebuild anything that is not on hold", async () => {
    const { settlement: s } = await built();

    await expect(rebuildSettlement(admin(), s._id)).rejects.toThrow(
      /only a settlement on hold can be rebuilt/i,
    );
  });
});

describe("cancelling and holding", () => {
  it("requires a reason to cancel", async () => {
    const { settlement: s } = await built();
    await expect(cancelSettlement(admin(), s._id, {})).rejects.toThrow(
      /say why you are cancelling/i,
    );
  });

  /**
   * ⚠️ The claim lock points one way, and every future cycle asks for
   * `settlementId: null`. A cancel that did not release would make this money
   * invisible to every cycle for ever — silently.
   */
  it("gives every row back on cancel", async () => {
    const { settlement: s } = await built({ payments: 2 });

    const result = await cancelSettlement(admin(), s._id, {
      reason: "Built from the wrong period",
    });

    expect(result.released.transactions).toBe(2);
    expect(await Transaction.countDocuments({ settlementId: s._id })).toBe(0);
  });

  it("holds without releasing, so an admin can look first", async () => {
    const { settlement: s } = await built({ payments: 2 });

    await holdSettlement(admin(), s._id, { reason: "Checking a figure" });

    expect(await Transaction.countDocuments({ settlementId: s._id })).toBe(2);
  });

  it("refuses a transition the machine does not allow", async () => {
    const { settlement: s } = await built({ status: SETTLEMENT_STATUS.PAID });

    await expect(
      cancelSettlement(admin(), s._id, { reason: "changed my mind" }),
    ).rejects.toThrow(/cannot become cancelled/i);
  });
});
