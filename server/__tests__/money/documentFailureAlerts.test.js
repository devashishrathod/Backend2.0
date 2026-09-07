const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Notification = require("../../models/Notification");
const User = require("../../models/User");
const Counter = require("../../models/Counter");
const Transaction = require("../../models/Transaction");
const { ROLES } = require("../../constants");
const { NOTIFICATION_TYPES } = require("../../constants/notification");

/**
 * A document that could not be issued has to reach a human.
 *
 * ### What was wrong
 *
 * Every issuer here is deliberately unable to throw: the money has already
 * moved, and failing a completed refund or a finished payout over a missing PDF
 * would be far worse than the missing PDF. That part was right. What was wrong
 * is that "must not fail" had been written as "must not be mentioned" — each one
 * ended in a bare `console.error`.
 *
 * So a customer holding a refund with no receipt, or a vendor with a payout and
 * no statement, was a fact nobody learned until they asked. The paid-subscription
 * path already alerted; these three did not. And unlike a transaction document
 * there is **no re-issue endpoint** for any of them, so nothing else was ever
 * going to surface it.
 *
 * ### The second half: a burned number
 *
 * `generateDocumentNumber` advances a shared counter. Anything that throws
 * between taking a number and writing it leaves that number attached to nothing
 * — a hole in a document-of-record series. `issueRefundDocument` took its number
 * before a config read and a transaction read, so a slow or missing row burned
 * one on the way past.
 */

// Named `mock*` deliberately: jest refuses a factory that closes over any other
// out-of-scope variable, and that prefix is the sanctioned escape hatch.
let mockRefundSnapshot;
let mockSettlementSnapshot;
let mockChargebackSnapshot;

jest.mock("../../helpers/refunds/buildRefundDocumentSnapshot", () => ({
  buildRefundDocumentSnapshot: (...args) => mockRefundSnapshot(...args),
}));
jest.mock("../../helpers/settlements/buildSettlementDocumentSnapshot", () => ({
  buildSettlementDocumentSnapshot: (...args) => mockSettlementSnapshot(...args),
}));
jest.mock("../../helpers/disputes/buildChargebackDocumentSnapshot", () => ({
  buildChargebackDocumentSnapshot: (...args) => mockChargebackSnapshot(...args),
}));

const { issueRefundDocument } = require("../../helpers/refunds");
const { issueSettlementDocument } = require("../../helpers/settlements");
const { issueChargebackDocument } = require("../../helpers/disputes");

const oid = () => new mongoose.Types.ObjectId();
const COLLECTIONS = [Notification, User, Counter, Transaction];

/**
 * `notifyAdmins` fans out one row per active admin — the feed is read per user,
 * so with nobody on the database it writes nothing, which is correct and
 * useless to assert on.
 */
const seedAdmin = () =>
  User.create({
    uniqueId: `USR-ADMIN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: "test admin",
    email: `admin${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`,
    mobile: `97${String(Date.now()).slice(-8)}`,
    role: ROLES.ADMIN,
    isActive: true,
  });

const alerts = () =>
  Notification.find({ type: NOTIFICATION_TYPES.WEBHOOK_FAILED }).lean();

const refundFixture = () => ({
  _id: oid(),
  transactionId: oid(),
  voucherClaimId: oid(),
  refundAmount: 810,
});

const settlementFixture = (overrides = {}) => ({
  _id: oid(),
  brandId: oid(),
  settlementNumber: "TD/STL/26-27/000004",
  netPayable: 12500,
  commissionAmount: 0,
  commissionTax: 0,
  periodEnd: new Date(),
  ...overrides,
});

const disputeFixture = () => ({
  _id: oid(),
  disputeId: "disp_TEST123",
  brandId: oid(),
  amount: 810,
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
  jest.restoreAllMocks();
  // Default: the snapshot cannot be built. That is the failure under test.
  const boom = () => {
    throw new Error("snapshot could not be built");
  };
  mockRefundSnapshot = boom;
  mockSettlementSnapshot = boom;
  mockChargebackSnapshot = boom;
});

describe("a document that cannot be issued reaches an admin", () => {
  it("alerts when a refund receipt fails, and still does not throw", async () => {
    const refundRequest = refundFixture();

    await expect(
      issueRefundDocument({ refundRequest, claim: {}, transaction: null }),
    ).resolves.toBeNull();

    const [alert] = await alerts();
    expect(alert).toBeTruthy();
    expect(alert.title).toBe("A refund receipt could not be issued");
    expect(String(alert.meta.recordId)).toBe(String(refundRequest._id));
    // The cause is carried, so an admin is not left guessing.
    expect(alert.meta.reason).toContain("snapshot");
  });

  it("alerts when a payout statement fails", async () => {
    const settlement = settlementFixture();

    await expect(issueSettlementDocument(settlement)).resolves.toBeNull();

    const [alert] = await alerts();
    expect(alert.title).toBe("A payout statement could not be issued");
    expect(String(alert.meta.recordId)).toBe(String(settlement._id));
  });

  /**
   * The commission is a taxable supply, so a statement that also lost its
   * commission invoice is a tax-record gap rather than missing paperwork. The
   * alert has to tell the two apart.
   */
  it("says so when the lost statement also carried a commission invoice", async () => {
    await issueSettlementDocument(
      settlementFixture({ commissionAmount: 250, commissionTax: 45 }),
    );

    const [alert] = await alerts();
    expect(alert.body).toContain("commission invoice");
  });

  it("does not claim a commission invoice was lost when none was charged", async () => {
    await issueSettlementDocument(settlementFixture());

    const [alert] = await alerts();
    expect(alert.body).not.toContain("commission invoice");
  });

  it("alerts when a chargeback advice fails", async () => {
    const dispute = disputeFixture();

    await expect(
      issueChargebackDocument({ dispute, transaction: { _id: oid() } }),
    ).resolves.toBeNull();

    const [alert] = await alerts();
    expect(alert.title).toBe("A chargeback advice could not be issued");
  });

  /**
   * Razorpay redelivers, and the ledger-repair paths run again. One alert per
   * record, or a retry storm becomes a mail storm about the same document.
   */
  it("raises one alert per record, however many times it fails", async () => {
    const refundRequest = refundFixture();

    await issueRefundDocument({ refundRequest, claim: {}, transaction: null });
    await issueRefundDocument({ refundRequest, claim: {}, transaction: null });
    await issueRefundDocument({ refundRequest, claim: {}, transaction: null });

    expect(await alerts()).toHaveLength(1);
  });

  /**
   * The alert is raised from inside a `catch` whose whole job is to let nothing
   * escape, so it must not become the thing that escapes.
   */
  it("does not throw even when the alert itself cannot be delivered", async () => {
    await User.deleteMany({}); // no admins — notifyAdmins has nobody to write to

    await expect(
      issueRefundDocument({
        refundRequest: refundFixture(),
        claim: {},
        transaction: null,
      }),
    ).resolves.toBeNull();
  });
});

describe("a failure must not burn a document number", () => {
  const refCounters = () =>
    Counter.find({ _id: { $regex: ":REF:" } })
      .lean()
      .then((rows) => rows);

  /**
   * The control. With the lookups working, the failure happens *after* the
   * number is taken — so a counter does exist. Without this the test below
   * passes whenever nothing allots at all, which would be true of a broken
   * fixture as much as of correct ordering.
   */
  it("takes a number when it gets as far as building the snapshot", async () => {
    await issueRefundDocument({
      refundRequest: refundFixture(),
      claim: {},
      transaction: null,
    });

    const counters = await refCounters();
    expect(counters).toHaveLength(1);
    expect(counters[0].sequence).toBeGreaterThan(0);
  });

  /**
   * ⚠️ The ordering fix. The number used to be allotted above this lookup, so a
   * database blip took a number out of the REF series and attached it to
   * nothing.
   */
  it("takes no number when it fails before the snapshot", async () => {
    jest.spyOn(Transaction, "findById").mockImplementation(() => {
      throw new Error("database unreachable");
    });

    await expect(
      issueRefundDocument({
        refundRequest: refundFixture(),
        claim: {},
        transaction: null,
      }),
    ).resolves.toBeNull();

    expect(await refCounters()).toHaveLength(0);
    // And it still told somebody.
    expect(await alerts()).toHaveLength(1);
  });
});
