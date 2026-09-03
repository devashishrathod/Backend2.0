const mongoose = require("mongoose");

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const Dispute = require("../../models/Dispute");
const { disputeDeadlines, stageFor } = require("../../services/transactions/disputeJobs");
const { getJobRegistry } = require("../../jobs");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");
const { DISPUTE_STATUS } = require("../../constants/webhook");

const oid = () => new mongoose.Types.ObjectId();
const HOUR_MS = 60 * 60 * 1000;
const hoursFromNow = (h) => new Date(Date.now() + h * HOUR_MS);

/**
 * A disputed payment, `hoursLeft` from its response deadline.
 *
 * Negative `hoursLeft` means the deadline has already passed.
 *
 * ⚠️ The dispute is its **own row** now. It was ten fields on the payment, which
 * holds exactly one — so a payment carrying a chargeback *and* the
 * pre-arbitration that followed it kept only the newest deadline and lost the
 * other, and a deadline that disappears is an automatic loss.
 */
const disputed = async ({
  hoursLeft,
  status = DISPUTE_STATUS.OPEN,
  alertsSent = 0,
}) => {
  const transaction = await Transaction.create({
    purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
    gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
    brandId: oid(),
    customerId: oid(),
    amount: 810,
    paidAmount: 810,
    verified: true,
    razorpayPaymentId: `pay_${Math.random().toString(36).slice(2, 12)}`,
  });

  return Dispute.create({
    disputeId: `disp_${Math.random().toString(36).slice(2, 12)}`,
    transactionId: transaction._id,
    brandId: transaction.brandId,
    status,
    amount: 810,
    respondBy: hoursFromNow(hoursLeft),
    alertsSent,
  });
};

const alertsOn = async (id) =>
  (await Dispute.findById(id).select("alertsSent").lean())?.alertsSent;

beforeAll(async () => {
  await connectTestDb();
  await Transaction.createIndexes();
  await Dispute.createIndexes();
});

afterAll(async () => {
  await clearCollections(Transaction, Dispute);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(Transaction, Dispute);
});

/**
 * ⚠️ Pure, and tested separately, because every branch below depends on it and
 * a staging bug reads as "the alert never came" — which is indistinguishable
 * from the job not running at all.
 */
describe("which warning a deadline has earned", () => {
  const THRESHOLDS = [72, 24];

  it("says nothing while there is still plenty of time", () => {
    expect(stageFor(100, THRESHOLDS)).toBe(0);
    expect(stageFor(72.1, THRESHOLDS)).toBe(0);
  });

  it("raises one stage per threshold crossed", () => {
    expect(stageFor(72, THRESHOLDS)).toBe(1);
    expect(stageFor(48, THRESHOLDS)).toBe(1);
    expect(stageFor(24, THRESHOLDS)).toBe(2);
    expect(stageFor(1, THRESHOLDS)).toBe(2);
  });

  it("puts a passed deadline above every threshold", () => {
    expect(stageFor(0, THRESHOLDS)).toBe(3);
    expect(stageFor(-50, THRESHOLDS)).toBe(3);
  });
});

describe("disputeDeadlines", () => {
  it("leaves a dispute alone while the deadline is far off", async () => {
    const txn = await disputed({ hoursLeft: 200 });

    const result = await disputeDeadlines();

    expect(result.alerted).toBe(0);
    expect(await alertsOn(txn._id)).toBe(0);
  });

  it("warns once as the deadline comes into range", async () => {
    const txn = await disputed({ hoursLeft: 48 });

    const result = await disputeDeadlines();

    expect(result.alerted).toBe(1);
    expect(result.overdue).toBe(0);
    expect(await alertsOn(txn._id)).toBe(1);
  });

  /**
   * ⚠️ The property that matters most.
   *
   * The job runs hourly, so a stage that re-sends every sweep would put 24
   * identical CRITICALs in front of an admin in a day — and the reliable
   * consequence of that is people muting the channel, which costs more than the
   * dispute did.
   */
  it("does not repeat a stage it has already sent", async () => {
    const txn = await disputed({ hoursLeft: 48 });

    await disputeDeadlines();
    const second = await disputeDeadlines();

    expect(second.alerted).toBe(0);
    expect(await alertsOn(txn._id)).toBe(1);
  });

  it("escalates again once the deadline gets close", async () => {
    const txn = await disputed({ hoursLeft: 12, alertsSent: 1 });

    const result = await disputeDeadlines();

    expect(result.alerted).toBe(1);
    expect(await alertsOn(txn._id)).toBe(2);
  });

  it("reports a deadline that has already passed", async () => {
    const txn = await disputed({ hoursLeft: -6, alertsSent: 2 });

    const result = await disputeDeadlines();

    expect(result.alerted).toBe(1);
    expect(result.overdue).toBe(1);
    expect(await alertsOn(txn._id)).toBe(3);
  });

  it("ignores a dispute that has already been decided", async () => {
    for (const status of [
      DISPUTE_STATUS.WON,
      DISPUTE_STATUS.LOST,
      DISPUTE_STATUS.CLOSED,
    ]) {
      await clearCollections(Transaction, Dispute);
      await disputed({ hoursLeft: 2, status });

      const result = await disputeDeadlines();
      expect(result.alerted).toBe(0);
    }
  });

  /**
   * ⚠️ Without this bound the sweep never drains: `OPEN` only leaves when
   * Razorpay sends a decision, so every dispute nobody answered would stay in
   * the query for ever and the job would re-scan a growing pile hourly.
   */
  it("stops chasing a deadline that went long ago", async () => {
    await disputed({ hoursLeft: -24 * 30, alertsSent: 0 });

    const result = await disputeDeadlines();

    expect(result.checked).toBe(0);
    expect(result.alerted).toBe(0);
  });

  it("takes the soonest deadlines first", async () => {
    await disputed({ hoursLeft: 60 });
    await disputed({ hoursLeft: 6 });
    await disputed({ hoursLeft: 30 });

    const result = await disputeDeadlines();

    expect(result.checked).toBe(3);
    expect(result.alerted).toBe(3);
  });
});

/**
 * ⚠️ This guards a real bug, not a hypothetical one.
 *
 * `jobs/index.js` importing `services/transactions` closed a require cycle —
 * `jobs → services/transactions → getPaymentHealth → jobs` — and Node answers a
 * cycle with a **partially built** exports object. The registry entry would have
 * been `run: undefined`: nothing throws at load, the job simply never runs, and
 * the first sign is a dispute deadline that passed with no warning.
 *
 * That is the same shape as the missing `};` that once made every settlement
 * impossible. A type check is cheap; finding it again is not.
 */
describe("the job is actually registered", () => {
  it("has disputeDeadlines in the registry", () => {
    const entry = getJobRegistry().find((j) => j.name === "disputeDeadlines");

    expect(entry).toBeDefined();
  });

  /**
   * The cycle guard proper.
   *
   * `jobs/index.js` reads this exact export to build its registry entry. If the
   * require cycle ever closes again, Node hands it a half-built exports object,
   * this becomes `undefined`, and the job is registered with `run: undefined` —
   * scheduled, never running, and silent about it.
   *
   * Asserting on the barrel rather than on the file is the point: importing
   * `disputeJobs.js` directly would sidestep the very path that breaks.
   */
  it("is a callable function on the services barrel", () => {
    const barrel = require("../../services/transactions");

    expect(typeof barrel.disputeDeadlines).toBe("function");
  });

  /**
   * The same guard for everything else `jobs/index.js` imports through a
   * barrel, so the next module added there cannot quietly repeat this.
   */
  it("leaves every job service barrel intact", () => {
    const barrels = [
      require("../../services/settlements"),
      require("../../services/refunds"),
      require("../../services/transactions"),
    ];

    for (const barrel of barrels) {
      expect(Object.keys(barrel).length).toBeGreaterThan(0);
      for (const [name, value] of Object.entries(barrel)) {
        expect([name, typeof value]).not.toEqual([name, "undefined"]);
      }
    }
  });
});
