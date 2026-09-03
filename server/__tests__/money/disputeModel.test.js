const mongoose = require("mongoose");

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const Dispute = require("../../models/Dispute");
const LedgerEntry = require("../../models/LedgerEntry");
const Settlement = require("../../models/Settlement");

const { recordDispute, summariseDisputes } = require("../../helpers/disputes");
const { postChargebackLoss } = require("../../helpers/ledger");
const {
  claimChargebackAdjustments,
  releaseSettlementClaims,
} = require("../../helpers/settlements");
const { disputeDeadlines } = require("../../services/transactions/disputeJobs");

const { DISPUTE_STATUS } = require("../../constants/webhook");
const { LEDGER_ENTRY_TYPE } = require("../../constants/ledger");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");
const { PAYMENT_STATUS } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();
const HOUR = 60 * 60 * 1000;
const secondsFromNow = (h) => Math.floor((Date.now() + h * HOUR) / 1000);

const COLLECTIONS = [Transaction, Dispute, LedgerEntry, Settlement];

let BRAND;
let txn;

/** An ₹810 payment whose vendor share is 800 − 50 promo − 0 commission = 750. */
const seed = async ({ settled = true } = {}) => {
  txn = await Transaction.create({
    purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
    gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
    brandId: BRAND,
    customerId: oid(),
    subBrandId: oid(),
    amount: 810,
    paidAmount: 810,
    status: PAYMENT_STATUS.CAPTURED,
    verified: true,
    razorpayPaymentId: `pay_${Math.random().toString(36).slice(2, 12)}`,
    invoiceId: "TD/VCH/26-27/000412",
    ...(settled ? { settlementId: oid() } : {}),
    voucher: {
      claimId: oid(),
      billAmount: 1000,
      netBill: 800,
      vendorPromoCost: 50,
      commissionAmount: 0,
      commissionDeduction: 0,
    },
  });
};

const entity = (id, overrides = {}) => ({
  id,
  amount: 81000,
  reason_code: "fraud",
  phase: "chargeback",
  respond_by: secondsFromNow(48),
  ...overrides,
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
  await seed();
});

/**
 * ⚠️ The reason this collection exists.
 *
 * Ten fields on `Transaction` hold exactly one dispute. Razorpay does not
 * promise one: a chargeback escalating to pre-arbitration and then arbitration
 * arrives as separate disputes with separate ids, amounts and **deadlines**, and
 * each `$set` replaced the last. A response deadline that disappears is an
 * automatic loss with nothing to show for it.
 */
describe("more than one dispute on one payment", () => {
  it("keeps them as separate rows", async () => {
    await recordDispute({
      transaction: txn,
      dispute: entity("disp_one", { respond_by: secondsFromNow(20) }),
      status: DISPUTE_STATUS.OPEN,
    });
    await recordDispute({
      transaction: txn,
      dispute: entity("disp_two", {
        phase: "pre_arbitration",
        respond_by: secondsFromNow(200),
      }),
      status: DISPUTE_STATUS.OPEN,
    });

    const rows = await Dispute.find({ transactionId: txn._id }).lean();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.disputeId).sort()).toEqual(["disp_one", "disp_two"]);
  });

  /**
   * ⚠️ The soonest **open** deadline, not the newest dispute's.
   *
   * With an escalation running beside the original, the one that matters is
   * whichever runs out first. Showing the other is showing a date nobody needs
   * to act on yet — while the real one passes.
   */
  it("summarises the soonest deadline still open", async () => {
    await recordDispute({
      transaction: txn,
      dispute: entity("disp_soon", { respond_by: secondsFromNow(10) }),
      status: DISPUTE_STATUS.OPEN,
    });
    await recordDispute({
      transaction: txn,
      dispute: entity("disp_later", { respond_by: secondsFromNow(500) }),
      status: DISPUTE_STATUS.OPEN,
    });

    const summary = await summariseDisputes(txn._id);

    expect(summary.disputeCount).toBe(2);
    expect(summary.isDisputed).toBe(true);
    const hoursOut = (new Date(summary.disputeRespondBy) - Date.now()) / HOUR;
    expect(hoursOut).toBeLessThan(20);
  });

  it("stops calling the payment disputed once every one is resolved", async () => {
    await recordDispute({
      transaction: txn,
      dispute: entity("disp_a"),
      status: DISPUTE_STATUS.OPEN,
    });
    await recordDispute({
      transaction: txn,
      dispute: entity("disp_b"),
      status: DISPUTE_STATUS.OPEN,
    });

    expect((await summariseDisputes(txn._id)).isDisputed).toBe(true);

    await recordDispute({
      transaction: txn,
      dispute: entity("disp_a"),
      status: DISPUTE_STATUS.WON,
    });
    expect((await summariseDisputes(txn._id)).isDisputed).toBe(true);

    await recordDispute({
      transaction: txn,
      dispute: entity("disp_b"),
      status: DISPUTE_STATUS.LOST,
    });
    expect((await summariseDisputes(txn._id)).isDisputed).toBe(false);
  });
});

/**
 * ⚠️ `constants/ledger.js` says it where it explains the dispute index:
 * Razorpay redelivers these **and sends them out of order** — a late `lost` can
 * follow a `won`.
 */
describe("out-of-order delivery", () => {
  it("does not let a stale event overwrite a newer one", async () => {
    const now = Date.now();

    await recordDispute({
      transaction: txn,
      dispute: entity("disp_x"),
      status: DISPUTE_STATUS.WON,
      eventAt: new Date(now),
    });

    // The `lost` was raised earlier but arrives now.
    const late = await recordDispute({
      transaction: txn,
      dispute: entity("disp_x"),
      status: DISPUTE_STATUS.LOST,
      eventAt: new Date(now - 60_000),
    });

    expect(late.applied).toBe(false);

    const row = await Dispute.findOne({ disputeId: "disp_x" }).lean();
    // Still won — and so nothing will be recovered from the vendor.
    expect(row.status).toBe(DISPUTE_STATUS.WON);
  });

  it("applies a newer event", async () => {
    const now = Date.now();

    await recordDispute({
      transaction: txn,
      dispute: entity("disp_y"),
      status: DISPUTE_STATUS.OPEN,
      eventAt: new Date(now - 60_000),
    });
    await recordDispute({
      transaction: txn,
      dispute: entity("disp_y"),
      status: DISPUTE_STATUS.LOST,
      eventAt: new Date(now),
    });

    const row = await Dispute.findOne({ disputeId: "disp_y" }).lean();
    expect(row.status).toBe(DISPUTE_STATUS.LOST);
  });

  it("is idempotent on a plain redelivery", async () => {
    const at = new Date();

    for (let i = 0; i < 3; i++) {
      await recordDispute({
        transaction: txn,
        dispute: entity("disp_z"),
        status: DISPUTE_STATUS.OPEN,
        eventAt: at,
      });
    }

    expect(await Dispute.countDocuments({ disputeId: "disp_z" })).toBe(1);
  });
});

/**
 * ⚠️ The money bug this whole change is about.
 *
 * The ledger already keyed on the dispute, so two lost disputes each booked
 * their own `CHARGEBACK`. The recovery keyed on the **payment**, so only one was
 * ever taken back — and the platform silently ate the other while the books
 * showed both losses.
 */
describe("two lost disputes on one payment", () => {
  const lose = async (id, amountPaise) => {
    await recordDispute({
      transaction: txn,
      dispute: entity(id, { amount: amountPaise }),
      status: DISPUTE_STATUS.LOST,
    });
    await postChargebackLoss({
      transaction: txn,
      disputeId: id,
      amount: amountPaise / 100,
    });
  };

  it("books each loss separately", async () => {
    await lose("disp_1", 20000);
    await lose("disp_2", 30000);

    const rows = await LedgerEntry.find({
      entryType: LEDGER_ENTRY_TYPE.CHARGEBACK,
      transactionId: txn._id,
    }).lean();

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.amount).sort((a, b) => a - b)).toEqual([200, 300]);
  });

  /**
   * ⚠️ The cumulative cap. Each call used to be checked against the whole vendor
   * share, so two disputes could together book more than the vendor was ever
   * paid — and the books would say we recovered money that never existed.
   */
  it("never books more than the vendor's share in total", async () => {
    // Vendor share is 750. Two disputes for 600 each.
    await lose("disp_big1", 60000);
    await lose("disp_big2", 60000);

    const rows = await LedgerEntry.find({
      entryType: LEDGER_ENTRY_TYPE.CHARGEBACK,
      transactionId: txn._id,
    }).lean();

    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    expect(total).toBeCloseTo(750, 2);
    // The first takes 600, the second only the 150 left.
    expect(rows.map((r) => r.amount).sort((a, b) => a - b)).toEqual([150, 600]);
  });

  it("recovers both, not just one", async () => {
    await lose("disp_r1", 20000);
    await lose("disp_r2", 30000);

    const settlementId = oid();
    const claimed = await claimChargebackAdjustments({
      settlementId,
      brandId: BRAND,
    });

    expect(claimed).toHaveLength(2);
    const total = claimed.reduce((sum, d) => sum + d.recoverAmount, 0);
    expect(total).toBeCloseTo(500, 2);
  });

  it("hands the same dispute back only once", async () => {
    await lose("disp_once", 20000);

    const first = await claimChargebackAdjustments({
      settlementId: oid(),
      brandId: BRAND,
    });
    const second = await claimChargebackAdjustments({
      settlementId: oid(),
      brandId: BRAND,
    });

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  /**
   * ⚠️ If the payment never reached the vendor, `settlementHold` already kept it
   * out of every cycle. Deducting anyway would take the loss from sales they
   * *were* paid for.
   */
  it("recovers nothing on a payment the vendor was never paid for", async () => {
    await clearCollections(...COLLECTIONS);
    BRAND = oid();
    await seed({ settled: false });
    await lose("disp_unpaid", 20000);

    const claimed = await claimChargebackAdjustments({
      settlementId: oid(),
      brandId: BRAND,
    });

    expect(claimed).toHaveLength(0);
  });

  /**
   * ⚠️ The third release path. A settlement that dies holding a dispute claim
   * leaves the loss marked as already recovered — no later cycle takes it, and
   * the vendor keeps money the bank took back from us.
   */
  it("frees the claim when the settlement dies", async () => {
    await lose("disp_free", 20000);
    const settlementId = oid();

    await claimChargebackAdjustments({ settlementId, brandId: BRAND });
    expect(
      await Dispute.countDocuments({ recoverySettlementId: settlementId }),
    ).toBe(1);

    const released = await releaseSettlementClaims(settlementId);
    expect(released.chargebacks).toBe(1);

    const again = await claimChargebackAdjustments({
      settlementId: oid(),
      brandId: BRAND,
    });
    expect(again).toHaveLength(1);
  });

  /**
   * A dispute won after it was lost gives the money back, so there is nothing to
   * recover — and it is left **unclaimed** rather than claimed for zero.
   *
   * ⚠️ Claiming it would stamp `recoverySettlementId` on a recovery that took
   * nothing, marking it settled for ever. If a later `lost` re-books the loss —
   * which is exactly what an out-of-order redelivery or a re-presentment does —
   * no cycle would ever pick it up again. That is the silently-forgiven bug this
   * lock exists to prevent, wearing a different hat.
   */
  it("leaves a reversed loss unclaimed rather than recovering zero", async () => {
    await lose("disp_rev", 20000);

    const { postChargebackReversal } = require("../../helpers/ledger");
    await postChargebackReversal({
      transaction: txn,
      disputeId: "disp_rev",
      amount: 200,
    });

    const claimed = await claimChargebackAdjustments({
      settlementId: oid(),
      brandId: BRAND,
    });

    expect(claimed).toHaveLength(0);

    // And still free for a later cycle, rather than marked recovered.
    const row = await Dispute.findOne({ disputeId: "disp_rev" }).lean();
    expect(row.recoverySettlementId).toBeFalsy();
  });
});

/**
 * ⚠️ The deadline job now reads `Dispute`. On `Transaction` there was one
 * `disputeRespondBy`, so a payment with two disputes had one deadline watched
 * and the other simply gone.
 */
describe("watching every deadline, not just the newest", () => {
  it("alerts on both disputes of one payment", async () => {
    await recordDispute({
      transaction: txn,
      dispute: entity("disp_d1", { respond_by: secondsFromNow(40) }),
      status: DISPUTE_STATUS.OPEN,
    });
    await recordDispute({
      transaction: txn,
      dispute: entity("disp_d2", { respond_by: secondsFromNow(48) }),
      status: DISPUTE_STATUS.OPEN,
    });

    const result = await disputeDeadlines();

    expect(result.checked).toBe(2);
    expect(result.alerted).toBe(2);
  });

  it("does not repeat a stage", async () => {
    await recordDispute({
      transaction: txn,
      dispute: entity("disp_once2", { respond_by: secondsFromNow(40) }),
      status: DISPUTE_STATUS.OPEN,
    });

    await disputeDeadlines();
    const second = await disputeDeadlines();

    expect(second.alerted).toBe(0);
  });

  it("ignores a dispute that has been decided", async () => {
    await recordDispute({
      transaction: txn,
      dispute: entity("disp_done", { respond_by: secondsFromNow(2) }),
      status: DISPUTE_STATUS.WON,
    });

    const result = await disputeDeadlines();
    expect(result.checked).toBe(0);
  });
});
