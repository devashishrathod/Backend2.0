const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const { recordFundsReceived } = require("../../helpers/transactions");
const {
  istDayStart,
  istDayEnd,
  istDaysAgo,
  istDateKey,
  settlementPeriodEnd,
  settlementPeriodStart,
} = require("../../helpers/dates");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");
const { PAYMENT_STATUS } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();

/**
 * The three things settlement cannot be built on top of until they are right.
 * None of them is settlement code; all three decide whether settlement pays the
 * correct money.
 */

describe("IST day boundaries", () => {
  /**
   * ⚠️ A UTC box computing "yesterday" puts the boundary at 05:30 IST, so five
   * and a half hours of one Indian day land in the wrong cycle — every day,
   * quietly, and only visible when a vendor adds up their own takings and gets a
   * different number.
   */
  it("uses the Indian date, not the server's", () => {
    // 01:45 IST on the 2nd — still the 1st in UTC.
    const at = new Date("2026-09-01T20:15:00Z");

    expect(istDateKey(at)).toBe("2026-09-02");
    expect(istDayStart(at).toISOString()).toBe("2026-09-01T18:30:00.000Z");
  });

  /**
   * `23:59:59.999`, not the next midnight — a range built with `$lte` must not
   * pick up the first millisecond of the following day.
   */
  it("ends the day just before the next one starts", () => {
    const at = new Date("2026-09-01T12:00:00Z");
    const end = istDayEnd(at);
    const nextStart = istDayStart(new Date(end.getTime() + 1));

    expect(end.toISOString()).toMatch(/18:29:59\.999Z$/);
    expect(nextStart.getTime()).toBe(end.getTime() + 1);
  });

  /**
   * ⚠️ The property the whole idempotency key rests on.
   *
   * `jobs/index.js` runs every job once at boot, and the runner is per-process —
   * so a restart or a second instance means `buildSettlements` runs again. The
   * key `STL:<brandId>:<periodEnd>` only protects anything if `periodEnd` is
   * **exactly** the same value both times. Derived from `new Date()` it is not,
   * and two settlements exist for one day.
   */
  it("gives one canonical value however often it is asked", () => {
    const base = new Date("2026-09-01T02:00:00Z");
    const values = new Set();

    for (let i = 0; i < 50; i += 1) {
      // Spread across a couple of seconds, as a boot storm would be.
      values.add(
        settlementPeriodEnd(3, new Date(base.getTime() + i * 137)).toISOString(),
      );
    }

    expect(values.size).toBe(1);
  });

  it("subtracts whole Indian days, not 24-hour blocks", () => {
    // Just past the IST boundary: subtracting raw hours would land on the day
    // before the one a person in India would name.
    const at = new Date("2026-09-01T18:35:00Z"); // 00:05 IST on the 2nd
    expect(istDateKey(istDaysAgo(1, at))).toBe("2026-09-01");
    expect(istDateKey(istDaysAgo(3, at))).toBe("2026-08-30");
  });

  it("spans exactly one whole day", () => {
    const start = settlementPeriodStart(3);
    const end = settlementPeriodEnd(3);

    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000 - 1);
  });
});

describe("funds actually reaching our bank", () => {
  let paid;

  beforeAll(async () => {
    await connectTestDb();
    await Transaction.createIndexes();
  });

  afterAll(async () => {
    await clearCollections(Transaction);
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearCollections(Transaction);
    paid = await Transaction.create({
      purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
      gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
      customerId: oid(),
      brandId: oid(),
      amount: 810,
      paidAmount: 810,
      status: PAYMENT_STATUS.CAPTURED,
      verified: true,
      razorpayPaymentId: "pay_MK1z9UcQ2Xa3bC",
    });
  });

  /**
   * ⚠️ `verifiedAt` says the customer paid. It does not say the money is ours to
   * pay out — Razorpay holds it for its own cycle first. A T+3 rule computed from
   * `verifiedAt` is a guess that the gateway will have settled by then, and when
   * it is wrong we pay a vendor from money that has not arrived.
   */
  it("is the only thing that fills fundsReceivedAt", async () => {
    expect(paid.fundsReceivedAt).toBeFalsy();

    const settledAt = new Date("2026-09-01T10:00:00Z");
    const result = await recordFundsReceived({
      settlementId: "setl_MK1z9UcQ2Xa3bC",
      settledAt,
      paymentIds: ["pay_MK1z9UcQ2Xa3bC"],
    });

    expect(result.updated).toBe(1);
    const after = await Transaction.findById(paid._id).lean();
    expect(after.fundsReceivedAt.toISOString()).toBe(settledAt.toISOString());
    expect(after.razorpaySettlementId).toBe("setl_MK1z9UcQ2Xa3bC");
  });

  /**
   * The gateway's own timestamp, not ours. A webhook that arrives two days late
   * must not make the money look two days newer than it is.
   */
  it("dates it when Razorpay settled, not when we heard", async () => {
    const settledAt = new Date("2026-08-28T04:00:00Z");
    await recordFundsReceived({
      settlementId: "setl_x",
      settledAt,
      paymentIds: ["pay_MK1z9UcQ2Xa3bC"],
    });

    const after = await Transaction.findById(paid._id).lean();
    expect(after.fundsReceivedAt.getTime()).toBe(settledAt.getTime());
    expect(after.fundsReceivedAt.getTime()).toBeLessThan(Date.now());
  });

  it("does nothing on a redelivery", async () => {
    const first = await recordFundsReceived({
      settlementId: "setl_x",
      settledAt: new Date("2026-09-01T10:00:00Z"),
      paymentIds: ["pay_MK1z9UcQ2Xa3bC"],
    });
    const second = await recordFundsReceived({
      settlementId: "setl_x",
      settledAt: new Date("2026-09-03T10:00:00Z"),
      paymentIds: ["pay_MK1z9UcQ2Xa3bC"],
    });

    expect(first.updated).toBe(1);
    expect(second.updated).toBe(0);
    // And the original timestamp is untouched.
    const after = await Transaction.findById(paid._id).lean();
    expect(after.fundsReceivedAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
  });

  it("ignores a payment that is not ours", async () => {
    const result = await recordFundsReceived({
      settlementId: "setl_x",
      settledAt: new Date(),
      paymentIds: ["pay_somebodyelse"],
    });
    expect(result.updated).toBe(0);
  });

  /**
   * One collection holds two money flows, so a settlement batch on the customer
   * account must not stamp a vendor subscription row.
   */
  it("never touches a subscription payment", async () => {
    const subscription = await Transaction.create({
      purpose: TRANSACTION_PURPOSE.SUBSCRIPTION,
      gatewayAccount: RAZORPAY_ACCOUNTS.VENDOR,
      brandId: oid(),
      amount: 4999,
      razorpayPaymentId: "pay_subscription",
    });

    await recordFundsReceived({
      settlementId: "setl_x",
      settledAt: new Date(),
      paymentIds: ["pay_subscription", "pay_MK1z9UcQ2Xa3bC"],
    });

    const after = await Transaction.findById(subscription._id).lean();
    expect(after.fundsReceivedAt).toBeFalsy();
  });

  it("says nothing happened rather than throwing on an empty batch", async () => {
    expect(
      await recordFundsReceived({ settlementId: "setl_x", paymentIds: [] }),
    ).toEqual({ matched: 0, updated: 0 });
  });
});
