/**
 * How much of a brand's payout is held back, and why.
 *
 * ### ⚠️ Why this file exists
 *
 * `reserve.percent` was one flat number for everyone, and `riskChargebackCount`
 * sat in `constants/customer.js`, in the `Setting` schema and in
 * `getCustomerConfig` — configurable from the admin panel — while **no code
 * anywhere read it**. The same shape `chargebackAdjustment: 0`,
 * `commissionTax: 0`, `reserveReleased: 0` and `chargeback.writeOffDays` all
 * had: wired at both ends, connected to nothing in the middle.
 *
 * The tests here pin the three judgements that make a per-brand rate safe rather
 * than merely per-brand: a count alone must not punish size, a rate off a
 * handful of sales must not count as evidence, and nothing may hold back so much
 * that a recoverable problem becomes a closed outlet.
 */
const mongoose = require("mongoose");

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const Dispute = require("../../models/Dispute");

const {
  buildReserveRiskMap,
  RESERVE_BASIS,
} = require("../../helpers/settlements");

const { DISPUTE_STATUS } = require("../../constants/webhook");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");
const { PAYMENT_STATUS } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms);

const COLLECTIONS = [Transaction, Dispute];

let BRAND;
let seq = 0;

/** The shape `getCustomerConfig().settlement` hands over. */
const settings = (overrides = {}) => ({
  newVendorReserveDays: 0,
  reserve: {
    isEnabled: true,
    percent: 5,
    holdDays: 30,
    riskChargebackCount: 2,
    riskLookbackDays: 180,
    riskMinPayments: 20,
    riskDisputeRatePercent: 1,
    riskPercent: 15,
    maxPercent: 25,
    ...(overrides.reserve || {}),
  },
  ...(({ reserve, ...rest }) => rest)(overrides),
});

const payments = async (count, { at = ago(10 * DAY) } = {}) => {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({
      purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
      gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
      customerId: oid(),
      brandId: BRAND,
      amount: 810,
      paidAmount: 810,
      status: PAYMENT_STATUS.CAPTURED,
      verified: true,
      verifiedAt: at,
      invoiceId: `TD/VCH/26-27/${String(++seq).padStart(6, "0")}`,
      voucher: { claimId: oid(), netBill: 800, vendorPromoCost: 0 },
    });
  }
  return Transaction.insertMany(rows);
};

const disputes = async (count, { status = DISPUTE_STATUS.LOST, at } = {}) => {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({
      disputeId: `disp_${Math.random().toString(36).slice(2, 12)}`,
      transactionId: oid(),
      brandId: BRAND,
      status,
      amount: 810,
      openedAt: at === undefined ? ago(10 * DAY) : at,
      lastEventAt: ago(10 * DAY),
    });
  }
  return Dispute.insertMany(rows);
};

const rateFor = async (config) => {
  const map = await buildReserveRiskMap({
    brandIds: [BRAND],
    settings: config || settings(),
  });
  return map.get(String(BRAND));
};

beforeAll(async () => {
  await connectTestDb();
  for (const m of COLLECTIONS) await m.createIndexes();
});

afterAll(async () => {
  await clearCollections(...COLLECTIONS);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(...COLLECTIONS);
  BRAND = oid();
});

describe("with the reserve switched off", () => {
  it("holds nothing and says so, without measuring anything", async () => {
    await payments(100);
    await disputes(30);

    const risk = await rateFor(settings({ reserve: { isEnabled: false } }));

    expect(risk).toMatchObject({
      percent: 0,
      basis: RESERVE_BASIS.DISABLED,
    });
  });
});

describe("a brand with nothing against them", () => {
  it("pays the base rate", async () => {
    await payments(100);

    const risk = await rateFor();

    expect(risk).toMatchObject({
      percent: 5,
      basis: RESERVE_BASIS.BASE,
      disputeCount: 0,
      paymentCount: 100,
    });
  });

  /**
   * ⚠️ A dispute we **won** is proof the sale was good.
   *
   * Holding a vendor's money on the strength of a case we won is not something
   * that can be defended to them, and the card networks' own merchant-monitoring
   * thresholds are not our billing policy.
   */
  it("is not made risky by disputes we won", async () => {
    await payments(100);
    await disputes(10, { status: DISPUTE_STATUS.WON });

    const risk = await rateFor();

    expect(risk).toMatchObject({ percent: 5, basis: RESERVE_BASIS.BASE });
    expect(risk.disputeCount).toBe(0);
  });

  /** Unresolved is exactly what a reserve is for — the outcome is not known yet. */
  it("counts a dispute that is still open", async () => {
    await payments(100);
    await disputes(4, { status: DISPUTE_STATUS.OPEN });

    const risk = await rateFor();

    expect(risk).toMatchObject({
      percent: 15,
      basis: RESERVE_BASIS.RISK_CHARGEBACKS,
      disputeCount: 4,
    });
  });
});

describe("a brand with a real chargeback problem", () => {
  it("moves to the raised rate", async () => {
    await payments(100);
    await disputes(4);

    const risk = await rateFor();

    expect(risk).toMatchObject({
      percent: 15,
      basis: RESERVE_BASIS.RISK_CHARGEBACKS,
      disputeCount: 4,
      paymentCount: 100,
      disputeRatePercent: 4,
    });
  });

  /**
   * ⚠️ The judgement that makes a count safe.
   *
   * 2 chargebacks out of 10,000 sales is a **better** merchant than 2 out of 40,
   * and a bare `riskChargebackCount >= 2` holds more from the first — punishing
   * exactly the brands worth keeping. The count is the trigger; the rate is the
   * test, and both have to be crossed.
   */
  it("does not punish a large brand for a handful of chargebacks", async () => {
    await payments(500);
    await disputes(4);

    const risk = await rateFor();

    expect(risk.disputeRatePercent).toBe(0.8);
    expect(risk).toMatchObject({ percent: 5, basis: RESERVE_BASIS.BASE });
  });

  /**
   * ⚠️ And the judgement that makes a rate safe.
   *
   * One chargeback out of three sales is 33% and means nothing — the sample is
   * too small to carry an opinion. Without the floor, a new outlet's unluckiest
   * week freezes a quarter of their money in their first month.
   */
  it("refuses to judge a brand on too few sales", async () => {
    await payments(6);
    await disputes(3);

    const risk = await rateFor();

    expect(risk.disputeRatePercent).toBe(50);
    expect(risk).toMatchObject({
      percent: 5,
      basis: RESERVE_BASIS.TOO_FEW_PAYMENTS,
    });
  });

  /**
   * Named rather than folded into `BASE`: *"we saw the chargebacks and had too
   * little to judge by"* and *"there is nothing against them"* are different
   * answers, and the first is the one somebody wants back when the volume grows.
   */
  it("says which of the two quiet outcomes it was", async () => {
    await payments(6);
    await disputes(3);
    const tooFew = await rateFor();

    await clearCollections(Dispute);
    const clean = await rateFor();

    expect(tooFew.basis).toBe(RESERVE_BASIS.TOO_FEW_PAYMENTS);
    expect(clean.basis).toBe(RESERVE_BASIS.BASE);
    expect(tooFew.percent).toBe(clean.percent);
  });

  /**
   * ⚠️ A ceiling is a business decision, not an arithmetic one. Without it a bad
   * month holds back nearly everything and cuts a vendor off from their own cash
   * flow — which is how a recoverable problem becomes a closed outlet.
   */
  it("never holds more than the ceiling, however bad the record", async () => {
    await payments(100);
    await disputes(60);

    const risk = await rateFor(
      settings({ reserve: { riskPercent: 90, maxPercent: 25 } }),
    );

    expect(risk.percent).toBe(25);
  });

  /** The ceiling binds a misconfigured **base** rate too, not just the risk one. */
  it("caps the base rate as well", async () => {
    await payments(100);

    const risk = await rateFor(
      settings({ reserve: { percent: 90, maxPercent: 25 } }),
    );

    expect(risk.percent).toBe(25);
  });
});

describe("the window", () => {
  it("ignores chargebacks older than the lookback", async () => {
    await payments(100);
    await disputes(6, { at: ago(400 * DAY) });

    const risk = await rateFor();

    expect(risk).toMatchObject({ disputeCount: 0, basis: RESERVE_BASIS.BASE });
  });

  /**
   * ⚠️ `openedAt` **with `createdAt` behind it**.
   *
   * Razorpay does send disputes that arrive already resolved, and those carry no
   * `openedAt`. Filtering on `openedAt` alone drops them from the count entirely
   * — so the worst cases would be exactly the ones that never registered.
   */
  it("still counts a dispute that arrived with no opened date", async () => {
    await payments(100);
    await disputes(4, { at: null });

    const risk = await rateFor();

    expect(risk.disputeCount).toBe(4);
    expect(risk.basis).toBe(RESERVE_BASIS.RISK_CHARGEBACKS);
  });

  it("ignores payments older than the lookback when working out the rate", async () => {
    await payments(500, { at: ago(400 * DAY) });
    await payments(30);
    await disputes(3);

    const risk = await rateFor();

    // 3 of 30 in the window, not 3 of 530.
    expect(risk.paymentCount).toBe(30);
    expect(risk.basis).toBe(RESERVE_BASIS.RISK_CHARGEBACKS);
  });
});

/**
 * ⚠️ Unproven means **more** held, not less — the reading an acquirer takes of a
 * new merchant. `newVendorReserveDays: 0` (today) switches it off entirely.
 */
describe("a brand nobody has any record of yet", () => {
  it("is left alone while the setting is zero", async () => {
    await payments(3, { at: ago(1 * DAY) });

    const risk = await rateFor();

    expect(risk).toMatchObject({ percent: 5, basis: RESERVE_BASIS.BASE });
  });

  it("holds the raised rate once the setting is on", async () => {
    await payments(3, { at: ago(1 * DAY) });

    const risk = await rateFor(settings({ newVendorReserveDays: 30 }));

    expect(risk).toMatchObject({
      percent: 15,
      basis: RESERVE_BASIS.NEW_VENDOR,
    });
  });

  it("leaves an established brand on the base rate", async () => {
    await payments(50, { at: ago(120 * DAY) });

    const risk = await rateFor(settings({ newVendorReserveDays: 30 }));

    expect(risk).toMatchObject({ percent: 5, basis: RESERVE_BASIS.BASE });
  });

  /** A real chargeback record outranks "new" — the reason is the more specific one. */
  it("reports the chargeback record rather than the age when both apply", async () => {
    await payments(30, { at: ago(1 * DAY) });
    await disputes(4);

    const risk = await rateFor(settings({ newVendorReserveDays: 30 }));

    expect(risk.basis).toBe(RESERVE_BASIS.RISK_CHARGEBACKS);
  });
});

/**
 * ⚠️ Two queries for the whole run, not two per brand.
 *
 * The obvious shape — a helper taking one `brandId`, called from inside the
 * per-brand loop — is correct and does not scale: a nightly build over 500
 * brands becomes 1,000 round trips, growing with exactly the number that grows.
 */
describe("many brands at once", () => {
  it("answers for all of them in one pass", async () => {
    const other = oid();
    await payments(100);
    await disputes(4);

    const before = BRAND;
    BRAND = other;
    await payments(100);
    BRAND = before;

    const map = await buildReserveRiskMap({
      brandIds: [BRAND, other],
      settings: settings(),
    });

    expect(map.get(String(BRAND)).basis).toBe(RESERVE_BASIS.RISK_CHARGEBACKS);
    expect(map.get(String(other)).basis).toBe(RESERVE_BASIS.BASE);
  });

  it("gives a brand with no rows at all the base rate rather than nothing", async () => {
    const unknown = oid();

    const map = await buildReserveRiskMap({
      brandIds: [unknown],
      settings: settings(),
    });

    expect(map.get(String(unknown))).toMatchObject({
      percent: 5,
      basis: RESERVE_BASIS.BASE,
      paymentCount: 0,
      disputeRatePercent: 0,
    });
  });
});
