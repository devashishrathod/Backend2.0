const mongoose = require("mongoose");

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Settlement = require("../../models/Settlement");
const Transaction = require("../../models/Transaction");
const RefundRequest = require("../../models/RefundRequest");

const { computeTotals } = require("../../services/settlements/buildSettlements");
const {
  claimMaturedReserves,
  brandsWithMaturedReserves,
  releaseSettlementClaims,
} = require("../../helpers/settlements");
const { SETTLEMENT_STATUS } = require("../../constants/settlement");

const oid = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (d) => new Date(Date.now() - d * DAY);

const RESERVE_ON = { reserve: { isEnabled: true, percent: 5, holdDays: 30 } };
const RESERVE_OFF = { reserve: { isEnabled: false, percent: 5, holdDays: 30 } };

const sale = (netBill) => ({
  voucher: { netBill, vendorPromoCost: 0, commissionAmount: 0, commissionDeduction: 0 },
});

/**
 * ⚠️ Every one of these runs with the reserve **switched on**.
 *
 * `reserve.isEnabled` is `false` by default, so at the shipped configuration the
 * whole reserve path computes zero and any mistake in it is invisible — the same
 * trap `commissionPercent: 0` and `chargebackAdjustment: 0` both set.
 *
 * And the mistake that was there was the expensive kind: `reserveHeld` was fully
 * wired while `reserveReleased` was a hardcoded `0`, `RESERVE_RELEASE` was a
 * ledger type nothing wrote, and there was no cycle that gave one back. Money
 * went in and never came out.
 */
describe("holding a reserve", () => {
  it("keeps a percentage back and pays out the rest", () => {
    const totals = computeTotals({
      transactions: [sale(1000)],
      refunds: [],
      settings: RESERVE_ON,
    });

    expect(totals.reserveHeld).toBe(50);
    expect(totals.netPayable).toBe(950);
  });

  it("holds nothing while the reserve is switched off", () => {
    const totals = computeTotals({
      transactions: [sale(1000)],
      refunds: [],
      settings: RESERVE_OFF,
    });

    expect(totals.reserveHeld).toBe(0);
    expect(totals.netPayable).toBe(1000);
  });

  it("never holds a reserve out of a negative cycle", () => {
    // More clawed back than earned: a reserve on that would invent money.
    const totals = computeTotals({
      transactions: [sale(100)],
      refunds: [{ split: { vendorClawback: 400 } }],
      settings: RESERVE_ON,
    });

    expect(totals.reserveHeld).toBe(0);
    expect(totals.netPayable).toBe(-300);
  });

  /**
   * ⚠️ **This brand's** rate, from `buildReserveRiskMap` — not the one flat
   * number every brand used to pay.
   */
  it("uses the rate the risk map chose for this brand", () => {
    const totals = computeTotals({
      transactions: [sale(1000)],
      refunds: [],
      settings: RESERVE_ON,
      risk: { percent: 15, basis: "RISK_CHARGEBACKS" },
    });

    expect(totals.reserveHeld).toBe(150);
    expect(totals.netPayable).toBe(850);
  });

  /**
   * A caller with no `risk` — a resume path, an older test — must land on
   * exactly the previous behaviour rather than silently holding nothing.
   */
  it("falls back to the base rate when no risk was worked out", () => {
    const totals = computeTotals({
      transactions: [sale(1000)],
      refunds: [],
      settings: RESERVE_ON,
    });

    expect(totals.reserveHeld).toBe(50);
  });

  /**
   * ⚠️ Frozen onto the row, with the working.
   *
   * The rate comes from a **trailing** window, so it has moved by the time
   * anybody opens the statement. Answering *"why was 15% withheld from me in
   * March?"* by recomputing gives a different number and the page stops adding
   * up — the same reason `computeTotals` never re-queries its own rows.
   */
  it("records the rate and the record it was chosen from", () => {
    const totals = computeTotals({
      transactions: [sale(1000)],
      refunds: [],
      settings: RESERVE_ON,
      risk: {
        percent: 15,
        basis: "RISK_CHARGEBACKS",
        disputeCount: 4,
        paymentCount: 260,
        disputeRatePercent: 1.54,
        lookbackDays: 180,
      },
    });

    expect(totals.reservePercent).toBe(15);
    expect(totals.reserveBasis).toEqual({
      reason: "RISK_CHARGEBACKS",
      disputeCount: 4,
      paymentCount: 260,
      disputeRatePercent: 1.54,
      lookbackDays: 180,
    });
  });
});

describe("giving it back", () => {
  it("adds a matured reserve to the payout", () => {
    const totals = computeTotals({
      transactions: [sale(1000)],
      refunds: [],
      reserves: [{ reserveHeld: 200 }],
      settings: RESERVE_ON,
    });

    expect(totals.reserveReleased).toBe(200);
    // 1000 − 50 newly held + 200 given back.
    expect(totals.netPayable).toBe(1150);
  });

  /**
   * ⚠️ The released reserve is added **after** the new hold is worked out.
   *
   * Folding it into the base would take a fresh 5% off money that has already
   * served its hold — a reserve on a reserve. At 5% a vendor's money would shrink
   * a little every cycle it passed through, for ever, and every individual
   * settlement would look correct.
   */
  it("does not hold a fresh reserve out of the one it is releasing", () => {
    const totals = computeTotals({
      transactions: [sale(1000)],
      refunds: [],
      reserves: [{ reserveHeld: 200 }],
      settings: RESERVE_ON,
    });

    // 5% of the 1,000 of sales, not of 1,200.
    expect(totals.reserveHeld).toBe(50);
  });

  it("can release a reserve in a cycle with no sales at all", () => {
    const totals = computeTotals({
      transactions: [],
      refunds: [],
      reserves: [{ reserveHeld: 200 }],
      settings: RESERVE_ON,
    });

    expect(totals.reserveHeld).toBe(0);
    expect(totals.netPayable).toBe(200);
  });
});

describe("claiming matured reserves", () => {
  const COLLECTIONS = [Settlement, Transaction, RefundRequest];

  let BRAND;

  const paidSettlement = async ({ reserveHeld, paidDaysAgo, released = false }) =>
    Settlement.create({
      brandId: BRAND,
      periodStart: daysAgo(paidDaysAgo + 1),
      periodEnd: daysAgo(paidDaysAgo),
      status: SETTLEMENT_STATUS.PAID,
      netPayable: 950,
      reserveHeld,
      paidAt: daysAgo(paidDaysAgo),
      idempotencyKey: `STL:${BRAND}:${Math.random()}`,
      ...(released ? { reserveReleaseSettlementId: oid() } : {}),
    });

  beforeAll(async () => {
    await connectTestDb();
    for (const model of COLLECTIONS) await model.createIndexes();
  });

  afterAll(async () => {
    await clearCollections(...COLLECTIONS);
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await clearCollections(...COLLECTIONS);
    BRAND = oid();
  });

  it("takes one whose hold has run out", async () => {
    await paidSettlement({ reserveHeld: 200, paidDaysAgo: 40 });

    const claimed = await claimMaturedReserves({
      settlementId: oid(),
      brandId: BRAND,
      maturedBefore: daysAgo(30),
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0].reserveHeld).toBe(200);
  });

  it("leaves one still inside its hold", async () => {
    await paidSettlement({ reserveHeld: 200, paidDaysAgo: 10 });

    const claimed = await claimMaturedReserves({
      settlementId: oid(),
      brandId: BRAND,
      maturedBefore: daysAgo(30),
    });

    expect(claimed).toHaveLength(0);
  });

  /**
   * ⚠️ The lock. A live "what has matured for this brand" query would return the
   * same reserve every cycle, adding it to the payout again and again — and each
   * month's arithmetic would be internally consistent while the vendor was paid
   * the same money repeatedly.
   */
  it("hands the same reserve back only once", async () => {
    await paidSettlement({ reserveHeld: 200, paidDaysAgo: 40 });

    const first = await claimMaturedReserves({
      settlementId: oid(),
      brandId: BRAND,
      maturedBefore: daysAgo(30),
    });
    const second = await claimMaturedReserves({
      settlementId: oid(),
      brandId: BRAND,
      maturedBefore: daysAgo(30),
    });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  /**
   * ⚠️ A reserve only exists once the payout it was withheld from actually left.
   * Releasing from a cancelled or carried-forward settlement would invent money
   * that was never held.
   */
  it("ignores a settlement that never paid", async () => {
    await Settlement.create({
      brandId: BRAND,
      periodStart: daysAgo(41),
      periodEnd: daysAgo(40),
      status: SETTLEMENT_STATUS.CARRIED_FORWARD,
      reserveHeld: 200,
      paidAt: daysAgo(40),
      idempotencyKey: `STL:${BRAND}:${Math.random()}`,
    });

    const claimed = await claimMaturedReserves({
      settlementId: oid(),
      brandId: BRAND,
      maturedBefore: daysAgo(30),
    });

    expect(claimed).toHaveLength(0);
  });

  /**
   * ⚠️ The third lock on the release path, after transactions and chargebacks.
   *
   * A settlement that dies holding somebody's reserve leaves it marked as already
   * released — no later cycle picks it up, and the vendor's money sits in a
   * reserve nobody will ever hand back. Silently, because the claim looks
   * perfectly satisfied.
   */
  it("puts a reserve back when the claiming settlement dies", async () => {
    const old = await paidSettlement({ reserveHeld: 200, paidDaysAgo: 40 });
    const claimer = oid();

    await claimMaturedReserves({
      settlementId: claimer,
      brandId: BRAND,
      maturedBefore: daysAgo(30),
    });

    const held = await Settlement.findById(old._id).lean();
    expect(String(held.reserveReleaseSettlementId)).toBe(String(claimer));

    const released = await releaseSettlementClaims(claimer);
    expect(released.reserves).toBe(1);

    const freed = await Settlement.findById(old._id).lean();
    expect(freed.reserveReleaseSettlementId).toBeNull();
    expect(freed.reserveReleasedAt).toBeNull();
  });

  /**
   * ⚠️ Without this a brand that stops trading never gets its reserve back.
   *
   * `brandsWithEligibleMoney` is a `distinct` over eligible **transactions**, so
   * a brand with no new sales is never even considered — and their money would
   * sit in a reserve for ever, with nothing anywhere to say so. It does not stop
   * being their money because they stopped selling.
   */
  it("finds a brand whose only claim is a matured reserve", async () => {
    await paidSettlement({ reserveHeld: 200, paidDaysAgo: 40 });

    const brands = await brandsWithMaturedReserves({ maturedBefore: daysAgo(30) });

    expect(brands.map(String)).toContain(String(BRAND));
  });

  it("stops listing that brand once the reserve is claimed", async () => {
    await paidSettlement({ reserveHeld: 200, paidDaysAgo: 40 });
    await claimMaturedReserves({
      settlementId: oid(),
      brandId: BRAND,
      maturedBefore: daysAgo(30),
    });

    const brands = await brandsWithMaturedReserves({ maturedBefore: daysAgo(30) });

    expect(brands.map(String)).not.toContain(String(BRAND));
  });
});
