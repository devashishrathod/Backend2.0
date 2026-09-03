const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const VoucherClaim = require("../../models/VoucherClaim");
const VoucherClaimHistory = require("../../models/VoucherClaimHistory");
const VoucherUsage = require("../../models/VoucherUsage");
const LedgerEntry = require("../../models/LedgerEntry");
const Notification = require("../../models/Notification");
const User = require("../../models/User");
const { ROLES } = require("../../constants");

const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
  SETTLEMENT_STAGE,
  GATEWAY_FEE_BEARER,
} = require("../../constants/transaction");
const { VOUCHER_CLAIM_STATUS } = require("../../constants/voucherClaim");
const { LEDGER_ENTRY_TYPE } = require("../../constants/ledger");

const oid = () => new mongoose.Types.ObjectId();

const PRICING = {
  currency: "INR",
  billAmount: 1000,
  offerDiscount: 200,
  netBill: 800,
  convenienceFee: 10,
  promoDiscount: 0,
  vendorPromoCost: 0,
  platformPromoCost: 0,
  totalPayable: 810,
  amountInPaise: 81000,
  youSaved: 200,
  vendorPayable: 800,
};

/**
 * The gateway, stubbed.
 *
 * These jobs are *about* asking Razorpay before acting, so the lookup is the
 * thing under test — not something to reach across the network for.
 */
// Named `mock*` deliberately: jest refuses a mock factory that closes over any
// other out-of-scope variable, and that prefix is the sanctioned escape hatch.
let mockPaymentLookup;
jest.mock("../../helpers/transactions/getPaymentDetails", () => ({
  getPaymentDetails: (...args) => mockPaymentLookup(...args),
}));

const {
  releaseStaleClaimHolds,
  resumeIncompleteSettlements,
  reconcileClaimPayments,
  alertStuckAuthorizations,
} = require("../../services/voucherClaims");

const seedClaim = async ({ ageMinutes = 60, ...overrides } = {}) => {
  const brandId = oid();
  const customerId = oid();
  const createdAt = new Date(Date.now() - ageMinutes * 60 * 1000);

  const transaction = await Transaction.create({
    purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
    gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
    customerId,
    brandId,
    amount: PRICING.totalPayable,
    verified: false,
    razorpayOrderId: `order_TEST${Date.now()}${Math.floor(Math.random() * 1000)}`,
    gatewayFeeBearer: GATEWAY_FEE_BEARER.PLATFORM,
    createdAt,
    ...overrides.transaction,
  });

  const claim = await VoucherClaim.create({
    customerId,
    voucherId: oid(),
    voucherVersionId: oid(),
    versionNumber: 1,
    offerId: oid(),
    brandId,
    subBrandId: oid(),
    billAmount: PRICING.billAmount,
    pricing: PRICING,
    transactionId: transaction._id,
    status: VOUCHER_CLAIM_STATUS.PENDING,
    claimCode: `TD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    holdsUsageSlot: true,
    isOncePerUser: true,
    voucherSnapshot: { name: "Test Voucher" },
    brandSnapshot: { name: "test brand" },
    outletSnapshot: { storeId: "T-01" },
    createdAt,
    ...overrides.claim,
  });

  return { transaction, claim, brandId, customerId };
};

const COLLECTIONS = [
  Transaction,
  VoucherClaim,
  VoucherClaimHistory,
  VoucherUsage,
  LedgerEntry,
  Notification,
  User,
];

/**
 * An admin to receive the alerts.
 *
 * `notifyAdmins` fans out to one row per active admin — the feed is read per
 * user, so a shared row would be marked read by whoever opened it first and
 * vanish for everyone else. With no admin on the database it writes nothing,
 * which is correct behaviour and useless for asserting on.
 */
const seedAdmin = () =>
  User.create({
    uniqueId: `USR-ADMIN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: "test admin",
    email: `admin${Date.now()}@example.com`,
    mobile: "9700000099",
    role: ROLES.ADMIN,
    isActive: true,
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
  await seedAdmin();
  // Default: nothing was captured.
  mockPaymentLookup = async () => ({ captured: false, status: "created" });
});

describe("the stale sweep asks the gateway before it cancels", () => {
  it("cancels an abandoned checkout and frees the slot", async () => {
    const { claim } = await seedClaim();

    const result = await releaseStaleClaimHolds();
    expect(result.cancelled).toBe(1);

    const after = await VoucherClaim.findById(claim._id);
    expect(after.status).toBe(VOUCHER_CLAIM_STATUS.CANCELLED);
    // The whole point: the customer gets their one use back.
    expect(after.holdsUsageSlot).toBe(false);
  });

  /**
   * The case that makes the gateway call necessary.
   *
   * A customer pays forty minutes after opening the tab, or the webhook is
   * simply late. Cancelling here frees the slot; by the time the payment
   * captures another claim may hold it, and the settle then fails on a duplicate
   * key **after the money was taken**.
   */
  it("leaves a claim alone once the payment has captured", async () => {
    const { claim, transaction } = await seedClaim();
    await Transaction.updateOne(
      { _id: transaction._id },
      { $set: { razorpayPaymentId: "pay_LATE" } },
    );
    mockPaymentLookup = async () => ({ captured: true, status: "captured" });

    const result = await releaseStaleClaimHolds();

    expect(result.cancelled).toBe(0);
    expect(result.keptForCapture).toBe(1);
    const after = await VoucherClaim.findById(claim._id);
    expect(after.status).toBe(VOUCHER_CLAIM_STATUS.PENDING);
    expect(after.holdsUsageSlot).toBe(true);
  });

  /**
   * "We do not know" must not become "cancel it".
   *
   * Skipping costs one more sweep cycle. Cancelling a paid claim costs a refund
   * and a complaint.
   */
  it("skips rather than cancels when the gateway cannot be reached", async () => {
    const { claim, transaction } = await seedClaim();
    await Transaction.updateOne(
      { _id: transaction._id },
      { $set: { razorpayPaymentId: "pay_UNKNOWN" } },
    );
    mockPaymentLookup = async () => {
      throw new Error("Razorpay unreachable");
    };

    const result = await releaseStaleClaimHolds();

    expect(result.cancelled).toBe(0);
    expect(result.keptForCapture).toBe(1);
    expect((await VoucherClaim.findById(claim._id)).status).toBe(
      VOUCHER_CLAIM_STATUS.PENDING,
    );
  });

  it("leaves a checkout that is still inside its window", async () => {
    await seedClaim({ ageMinutes: 1 });
    const result = await releaseStaleClaimHolds();
    expect(result.checked).toBe(0);
  });

  it("records why it cancelled", async () => {
    const { claim } = await seedClaim();
    await releaseStaleClaimHolds();

    const row = await VoucherClaimHistory.findOne({ claimId: claim._id });
    expect(row.toStatus).toBe(VOUCHER_CLAIM_STATUS.CANCELLED);
    expect(row.reason).toBe("Checkout was not completed");
  });
});

describe("stranded settlements are finished", () => {
  /**
   * The crash this whole staged design exists for: claimed, then abandoned,
   * with no way back in through verify or the webhook.
   */
  const strand = async (stage = SETTLEMENT_STAGE.CLAIMED) => {
    const { transaction, claim, brandId } = await seedClaim();
    await Transaction.updateOne(
      { _id: transaction._id },
      {
        $set: {
          verified: true,
          verifiedAt: new Date(Date.now() - 30 * 60 * 1000),
          settlementStage: stage,
          razorpayPaymentId: "pay_STRANDED",
          gatewayFee: 17.94,
        },
      },
    );
    return { transaction, claim, brandId };
  };

  it("picks up a transaction left mid-settle and finishes it", async () => {
    const { claim, brandId } = await strand();

    const result = await resumeIncompleteSettlements();

    expect(result.found).toBe(1);
    expect(result.resumed).toBe(1);
    expect((await VoucherClaim.findById(claim._id)).status).toBe(
      VOUCHER_CLAIM_STATUS.REDEEMED,
    );
    expect(
      await LedgerEntry.countDocuments({
        brandId,
        entryType: LEDGER_ENTRY_TYPE.COLLECTION,
      }),
    ).toBe(1);
  });

  it("ignores a settlement that already completed", async () => {
    await strand(SETTLEMENT_STAGE.COMPLETE);
    const result = await resumeIncompleteSettlements();
    expect(result.found).toBe(0);
  });

  /**
   * ⚠️ `settlementStage != "COMPLETE"` is true of a **missing** field, and every
   * transaction written before the field existed has none. Without the
   * `$exists` guard the first run would try to re-settle the entire history.
   */
  it("does not touch rows that predate settlementStage", async () => {
    const { transaction } = await seedClaim();
    await Transaction.collection.updateOne(
      { _id: transaction._id },
      {
        $set: { verified: true, verifiedAt: new Date(Date.now() - 3600000) },
        $unset: { settlementStage: "" },
      },
    );

    const result = await resumeIncompleteSettlements();
    expect(result.found).toBe(0);
  });

  it("does not touch a subscription transaction", async () => {
    await Transaction.create({
      purpose: TRANSACTION_PURPOSE.SUBSCRIPTION,
      gatewayAccount: RAZORPAY_ACCOUNTS.VENDOR,
      brandId: oid(),
      amount: 4999,
      verified: true,
      verifiedAt: new Date(Date.now() - 3600000),
      settlementStage: SETTLEMENT_STAGE.CLAIMED,
    });

    // The two settlers share nothing; running one on the other's row would fail
    // on "this payment has no voucher claim attached to it".
    const result = await resumeIncompleteSettlements();
    expect(result.found).toBe(0);
  });

  it("leaves a settlement that has only just been claimed", async () => {
    const { transaction } = await seedClaim();
    await Transaction.updateOne(
      { _id: transaction._id },
      {
        $set: {
          verified: true,
          // Seconds ago — the settle is probably still running.
          verifiedAt: new Date(),
          settlementStage: SETTLEMENT_STAGE.CLAIMED,
        },
      },
    );

    const result = await resumeIncompleteSettlements();
    expect(result.found).toBe(0);
  });
});

describe("payments the gateway took that nobody told us about", () => {
  /**
   * The webhook can be lost — a bad secret, a deploy window, a delivery Razorpay
   * gave up on. The browser callback is lost whenever the customer closes the
   * tab. When both are lost, the money is captured and nothing here knows.
   */
  it("finds a captured payment and settles it", async () => {
    const { transaction, claim, brandId } = await seedClaim();
    await Transaction.updateOne(
      { _id: transaction._id },
      { $set: { razorpayPaymentId: "pay_LOST" } },
    );
    mockPaymentLookup = async () => ({
      id: "pay_LOST",
      captured: true,
      status: "captured",
      amount: 81000,
      fee: 1794,
      tax: 274,
    });

    const result = await reconcileClaimPayments();

    expect(result.recovered).toBe(1);
    expect((await VoucherClaim.findById(claim._id)).status).toBe(
      VOUCHER_CLAIM_STATUS.REDEEMED,
    );
    expect(
      await LedgerEntry.countDocuments({ brandId, entryType: LEDGER_ENTRY_TYPE.COLLECTION }),
    ).toBe(1);
  });

  it("says so, because a missing webhook is itself the problem", async () => {
    const { transaction } = await seedClaim();
    await Transaction.updateOne(
      { _id: transaction._id },
      { $set: { razorpayPaymentId: "pay_LOST" } },
    );
    mockPaymentLookup = async () => ({
      id: "pay_LOST", captured: true, status: "captured", amount: 81000, fee: 1794, tax: 274,
    });

    await reconcileClaimPayments();

    // Recovering the money is not the end of it — somebody has to find out why
    // the webhook never arrived.
    const alert = await Notification.findOne({ "meta.razorpayPaymentId": "pay_LOST" });
    expect(alert).toBeTruthy();
  });

  it("leaves an uncaptured payment alone", async () => {
    const { transaction, claim } = await seedClaim();
    await Transaction.updateOne(
      { _id: transaction._id },
      { $set: { razorpayPaymentId: "pay_NEVER" } },
    );

    const result = await reconcileClaimPayments();
    expect(result.recovered).toBe(0);
    expect((await VoucherClaim.findById(claim._id)).status).toBe(
      VOUCHER_CLAIM_STATUS.PENDING,
    );
  });

  it("skips an order that never reached a payment at all", async () => {
    await seedClaim();
    // No `razorpayPaymentId` — nothing to look up. The stale sweep closes it.
    const result = await reconcileClaimPayments();
    expect(result.checked).toBe(1);
    expect(result.recovered).toBe(0);
  });
});

describe("money the bank is holding that nobody has taken", () => {
  /**
   * Razorpay auto-refunds an uncaptured authorization after about five days,
   * which the customer experiences as a silent failure: charged, nothing
   * received, money quietly back with no explanation.
   */
  it("alerts on a payment stuck in authorized", async () => {
    const { transaction } = await seedClaim();
    await Transaction.updateOne(
      { _id: transaction._id },
      {
        $set: {
          authorizedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
          razorpayPaymentId: "pay_AUTHORIZED",
        },
      },
    );

    const result = await alertStuckAuthorizations();
    expect(result.stuck).toBe(1);

    const alert = await Notification.findOne({});
    expect(alert.title).toContain("authorized but never captured");
    // If this fires at all, auto-capture is off and every payment is in the
    // same state — so the alert says where to look.
    expect(alert.body).toContain("auto-capture");
  });

  it("does not alert on one that was authorized moments ago", async () => {
    const { transaction } = await seedClaim();
    await Transaction.updateOne(
      { _id: transaction._id },
      { $set: { authorizedAt: new Date() } },
    );

    expect((await alertStuckAuthorizations()).stuck).toBe(0);
  });

  it("does not alert on a payment that went on to capture", async () => {
    const { transaction } = await seedClaim();
    await Transaction.updateOne(
      { _id: transaction._id },
      {
        $set: {
          authorizedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
          verified: true,
        },
      },
    );

    expect((await alertStuckAuthorizations()).stuck).toBe(0);
  });

  it("sends one alert, not one per payment", async () => {
    for (let i = 0; i < 3; i++) {
      const { transaction } = await seedClaim();
      await Transaction.updateOne(
        { _id: transaction._id },
        { $set: { authorizedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } },
      );
    }

    const result = await alertStuckAuthorizations();
    expect(result.stuck).toBe(3);
    // With auto-capture off there would be hundreds, all saying the same thing.
    // One row per admin, not one per stuck payment.
    expect(await Notification.countDocuments({})).toBe(1);
  });
});
