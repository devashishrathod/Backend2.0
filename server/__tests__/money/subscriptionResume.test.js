const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Brand = require("../../models/Brand");
const User = require("../../models/User");
const Subscription = require("../../models/Subscription");
const Subscribed = require("../../models/Subscribed");
const SubscribedHistory = require("../../models/SubscribedHistory");
const Transaction = require("../../models/Transaction");
const Notification = require("../../models/Notification");

/**
 * ⚠️ The **leaf** module is mocked, not the barrel.
 *
 * `settleSubscriptionPayment` destructures `generateDocumentNumber` at require
 * time, so the local binding is captured before any test runs — a `jest.spyOn`
 * on `helpers/documents` replaces a property nobody reads again and the mock
 * silently does nothing. Mocking the file the barrel re-exports works, because
 * the barrel requires it too.
 *
 * Named `mock*` deliberately: jest refuses a factory that closes over any other
 * out-of-scope variable, and that prefix is the sanctioned escape hatch.
 */
let mockGenerateDocumentNumber;
jest.mock("../../helpers/documents/generateDocumentNumber", () => {
  const actual = jest.requireActual(
    "../../helpers/documents/generateDocumentNumber",
  );
  return {
    generateDocumentNumber: (...args) =>
      mockGenerateDocumentNumber
        ? mockGenerateDocumentNumber(...args)
        : actual.generateDocumentNumber(...args),
  };
});

const { generateBrandMerchantId } = require("../../helpers/brands");
const {
  activateSubscription,
  settleSubscriptionPayment,
} = require("../../helpers/subscribeds");
const {
  resumeIncompleteSettlements,
} = require("../../services/transactions/settlementJobs");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
  SETTLEMENT_STAGE,
} = require("../../constants/transaction");
const {
  SUBSCRIBED_STATUS,
  SUBSCRIPTION_ACTION,
} = require("../../constants/subscription");
// ⚠️ `SUBSCRIPTION_TYPES` lives in the root constants barrel, not the
// subscription one — the model imports it from there too.
const { ROLES, SUBSCRIPTION_TYPES } = require("../../constants");
const { NOTIFICATION_TYPES } = require("../../constants/notification");

/**
 * Resuming a subscription settlement that was claimed and then abandoned.
 *
 * ### Why this file exists
 *
 * `resumeIncompleteSettlements` swept voucher claims only, so a vendor whose
 * subscription settlement died half-way stayed stranded forever: their money was
 * taken, and nothing ever came back to finish activating the plan or issuing the
 * invoice.
 *
 * Widening that sweep is not the hard part. The hard part is that a resume
 * **deliberately skips the conditional claim** — that is what makes it a resume
 * — and that claim was the only thing preventing `activateSubscription` from
 * running twice. Run twice, unguarded, it creates a second ACTIVE plan and then
 * hands the vendor's just-purchased one to the supersede block, which retires it
 * and bills the whole unused term as forfeited. That number reaches the
 * goodwill-credit worklist behind `GET /subscribeds/admin/forfeited`, so the
 * failure is not cosmetic: it invents a debt against a vendor who is owed
 * nothing.
 *
 * So the tests below are mostly about what must *not* happen on the second run.
 */

const oid = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;

const COLLECTIONS = [
  Brand,
  User,
  Subscription,
  Subscribed,
  SubscribedHistory,
  Transaction,
  Notification,
];

const PRICING = {
  currency: "INR",
  listPrice: 4999,
  discountAmount: 0,
  promoDiscount: 0,
  taxableValue: 4999,
  gstPercentage: 0,
  gstAmount: 0,
  totalPayable: 4999,
  amountInPaise: 499900,
};

let BRAND;
let PLAN;
let VENDOR;

const seedPlan = () =>
  Subscription.create({
    name: "Pro Plus",
    description: "test plan",
    price: 4999,
    type: SUBSCRIPTION_TYPES.YEARLY,
    durationInYears: 1,
    durationInDays: 365,
    // What the plan gates actually read. Without them `applyPlanEntitlements`
    // falls back to defaults and warns on every activation, which buries the
    // real output of this file.
    entitlements: {
      subBrands: { limit: 10, isUnlimited: false },
      franchises: { limit: 5, isUnlimited: false },
      vouchers: { limit: 0, isUnlimited: true },
      showcase: { limit: 20, isUnlimited: false },
      dealPack: { isEnabled: true },
      prioritySupport: { isEnabled: true },
    },
    isActive: true,
  });

const seedVendor = () =>
  User.create({
    uniqueId: `USR-V-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: "test vendor",
    email: `vendor${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`,
    mobile: `97${String(Date.now()).slice(-8)}`,
    role: ROLES.VENDOR,
    isActive: true,
  });

/** A subscription payment that has already been claimed and left mid-settle. */
const seedStrandedPayment = async (overrides = {}) =>
  Transaction.create({
    purpose: TRANSACTION_PURPOSE.SUBSCRIPTION,
    gatewayAccount: RAZORPAY_ACCOUNTS.VENDOR,
    brandId: BRAND._id,
    subscriptionId: PLAN._id,
    createdBy: VENDOR._id,
    amount: PRICING.totalPayable,
    paidAmount: PRICING.totalPayable,
    pricing: PRICING,
    razorpayOrderId: `order_SUB${Date.now()}${Math.floor(Math.random() * 1000)}`,
    razorpayPaymentId: `pay_SUB${Date.now()}${Math.floor(Math.random() * 1000)}`,
    verified: true,
    // Claimed, then the process died before the domain records were written.
    verifiedAt: new Date(Date.now() - 30 * 60 * 1000),
    settlementStage: SETTLEMENT_STAGE.CLAIMED,
    ...overrides,
  });

const validityFrom = (start) => ({
  startDate: start,
  endDate: new Date(start.getTime() + 365 * DAY),
});

const activate = (transaction, validity) =>
  activateSubscription({
    brand: BRAND,
    subscription: PLAN.toObject(),
    actor: { userId: VENDOR._id, role: ROLES.VENDOR },
    action: SUBSCRIPTION_ACTION.NEW,
    pricing: PRICING,
    validity,
    transaction,
    paidAmount: PRICING.totalPayable,
    dueAmount: 0,
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
  // Null means "use the real one" — the failure tests opt in.
  mockGenerateDocumentNumber = null;
  /**
   * `notifyAdmins` fans out one row per active admin, so with nobody on the
   * database it writes nothing — correct behaviour, and useless to assert on.
   */
  await User.create({
    uniqueId: `USR-ADMIN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: "test admin",
    email: `admin${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`,
    mobile: `98${String(Date.now()).slice(-8)}`,
    role: ROLES.ADMIN,
    isActive: true,
  });
  VENDOR = await seedVendor();
  BRAND = await Brand.create({
    brandName: "test brand",
    uniqueId: `TDB${Date.now()}${Math.floor(Math.random() * 1000)}`,
    userId: VENDOR._id,
    merchantId: await generateBrandMerchantId(),
  });
  PLAN = await seedPlan();
});

describe("activating twice for one transaction", () => {
  it("creates one subscription, not two", async () => {
    const transaction = await seedStrandedPayment();
    const validity = validityFrom(new Date());

    const first = await activate(transaction, validity);
    const second = await activate(transaction, validityFrom(new Date()));

    expect(first.resumed).toBe(false);
    expect(second.resumed).toBe(true);
    // Same record, not a copy of it.
    expect(String(second.subscribed._id)).toBe(String(first.subscribed._id));

    expect(await Subscribed.countDocuments({ brandId: BRAND._id })).toBe(1);
  });

  /**
   * The expensive one.
   *
   * Unguarded, the second run treats the first run's plan as "the plan being
   * replaced": it is marked UPGRADED, its end date is dragged back to now, and
   * `measureForfeit` values the entire unused year as lost. The vendor then
   * appears on the goodwill-credit worklist owed a refund for a plan they are
   * still happily using.
   */
  it("does not retire the plan it just created, or invent a forfeit", async () => {
    const transaction = await seedStrandedPayment();
    const start = new Date();
    const { subscribed } = await activate(transaction, validityFrom(start));

    await activate(transaction, validityFrom(new Date()));

    const after = await Subscribed.findById(subscribed._id);
    expect(after.status).toBe(SUBSCRIBED_STATUS.ACTIVE);
    expect(after.isActive).toBe(true);
    expect(after.isExpired).toBe(false);
    expect(after.forfeitedDays || 0).toBe(0);
    expect(after.forfeitedValue || 0).toBe(0);
    expect(after.numberOfUpgrade || 0).toBe(0);
    // Nothing points forward, because nothing superseded it.
    expect(after.upgradedTo).toBeFalsy();
    expect(after.downgradedTo).toBeFalsy();

    // And the term is still the one that was paid for.
    expect(after.endDate.getTime()).toBe(start.getTime() + 365 * DAY);
  });

  it("writes one audit row, not one per attempt", async () => {
    const transaction = await seedStrandedPayment();
    await activate(transaction, validityFrom(new Date()));
    await activate(transaction, validityFrom(new Date()));

    expect(await SubscribedHistory.countDocuments({ brandId: BRAND._id })).toBe(1);
  });

  /**
   * The read-then-insert above is two operations, so two sweeps running together
   * can both find nothing and both try to create. The database is what decides,
   * and the loser adopts the winner's row rather than failing the settlement.
   */
  it("survives two activations racing, by index rather than by luck", async () => {
    const transaction = await seedStrandedPayment();

    const results = await Promise.all([
      activate(transaction, validityFrom(new Date())),
      activate(transaction, validityFrom(new Date())),
    ]);

    expect(await Subscribed.countDocuments({ brandId: BRAND._id })).toBe(1);
    // Both callers get a usable record back — neither is handed an error.
    for (const result of results) expect(result.subscribed).toBeTruthy();
    expect(String(results[0].subscribed._id)).toBe(
      String(results[1].subscribed._id),
    );
  });

  it("refuses a second subscription for one transaction at the database", async () => {
    const transaction = await seedStrandedPayment();
    await activate(transaction, validityFrom(new Date()));

    await expect(
      Subscribed.create({
        userId: VENDOR._id,
        brandId: BRAND._id,
        transactionId: transaction._id,
        subscriptionId: PLAN._id,
        startDate: new Date(),
        endDate: new Date(Date.now() + DAY),
        status: SUBSCRIBED_STATUS.ACTIVE,
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  /**
   * The partial filter has to hold, or the index breaks the flows that have no
   * transaction at all — an admin plan change, and the Postman seeder. They would
   * otherwise all collide on a single `null`.
   */
  it("still allows many subscriptions with no transaction", async () => {
    const rows = await Promise.all(
      [1, 2, 3].map(() =>
        Subscribed.create({
          userId: VENDOR._id,
          brandId: oid(),
          subscriptionId: PLAN._id,
          startDate: new Date(),
          endDate: new Date(Date.now() + DAY),
          status: SUBSCRIBED_STATUS.ACTIVE,
        }),
      ),
    );
    expect(rows).toHaveLength(3);
  });
});

describe("settling with resume: true", () => {
  /**
   * The job has no gateway payload — the payment was recorded on the row long
   * ago — so it passes a synthetic stand-in. Every money check reads that
   * payload, and fed this one they would throw: the amount check on `undefined`,
   * and `!captured` would release a promo code that is already committed.
   */
  it("finishes a stranded settlement instead of throwing on the synthetic payment", async () => {
    const transaction = await seedStrandedPayment();

    const result = await settleSubscriptionPayment({
      transaction,
      payment: { captured: true, id: transaction.razorpayPaymentId },
      resume: true,
    });

    expect(result.alreadySettled).toBe(false);
    expect(result.subscribed).toBeTruthy();

    const after = await Transaction.findById(transaction._id);
    expect(after.settlementStage).toBe(SETTLEMENT_STAGE.COMPLETE);
    expect(after.invoiceId).toBeTruthy();
    expect(after.documentToken).toBeTruthy();
  });

  /**
   * Without the resume branch this is what happened: the conditional claim finds
   * `verified: true`, concludes somebody else won, and reports `alreadySettled`
   * — success, having repaired nothing. The job would have counted it as
   * resumed and moved on, forever.
   */
  it("does not report alreadySettled and walk away", async () => {
    const transaction = await seedStrandedPayment();

    const result = await settleSubscriptionPayment({
      transaction,
      payment: { captured: true, id: transaction.razorpayPaymentId },
      resume: true,
    });

    expect(result.alreadySettled).toBe(false);
    expect(await Subscribed.countDocuments({ brandId: BRAND._id })).toBe(1);
  });

  /** The real money on the row must survive a resume untouched. */
  it("does not overwrite the recorded payment with the synthetic one", async () => {
    const transaction = await seedStrandedPayment();

    await settleSubscriptionPayment({
      transaction,
      payment: { captured: true, id: transaction.razorpayPaymentId },
      resume: true,
    });

    const after = await Transaction.findById(transaction._id);
    expect(after.paidAmount).toBe(PRICING.totalPayable);
    expect(after.razorpayPaymentId).toBe(transaction.razorpayPaymentId);
    // The moment the money actually arrived, not the moment it was repaired.
    expect(after.verifiedAt.getTime()).toBe(transaction.verifiedAt.getTime());
  });

  /**
   * ⚠️ The requirement that a document's dates are the real ones and never shift.
   *
   * `validity` is recomputed from `new Date()` on every call. A resume days after
   * the purchase would otherwise number an invoice against today, printing a
   * start date the plan never had and an end date a year past the vendor's real
   * entitlement.
   */
  it("dates the invoice from the plan, not from the day it was repaired", async () => {
    const transaction = await seedStrandedPayment();

    // Activate first, as the original run did, with a term that started days ago.
    const start = new Date(Date.now() - 3 * DAY);
    await activate(transaction, validityFrom(start));

    // Then resume, which recomputes `validity` as "now".
    await settleSubscriptionPayment({
      transaction,
      payment: { captured: true, id: transaction.razorpayPaymentId },
      resume: true,
    });

    const after = await Transaction.findById(transaction._id);
    const timeline = Object.fromEntries(
      after.invoiceSnapshot.timeline.map((row) => [row.label, row.at]),
    );

    expect(timeline["Plan starts"].getTime()).toBe(start.getTime());
    expect(timeline["Plan ends"].getTime()).toBe(start.getTime() + 365 * DAY);
  });

  /**
   * A GST series may not have holes, so a resume must never burn a second
   * number on a transaction that already has one.
   */
  it("keeps the invoice number it already issued", async () => {
    const transaction = await seedStrandedPayment();

    await settleSubscriptionPayment({
      transaction,
      payment: { captured: true, id: transaction.razorpayPaymentId },
      resume: true,
    });
    const first = await Transaction.findById(transaction._id);

    await settleSubscriptionPayment({
      transaction: first,
      payment: { captured: true, id: first.razorpayPaymentId },
      resume: true,
    });
    const second = await Transaction.findById(transaction._id);

    expect(second.invoiceId).toBe(first.invoiceId);
    expect(second.documentToken).toBe(first.documentToken);
  });

  /**
   * The activation notice was the one subscription notice with no dedupe key,
   * so every sweep told the vendor again that their plan had gone live — by
   * email, push and WhatsApp.
   */
  it("tells the vendor their plan is live exactly once", async () => {
    const transaction = await seedStrandedPayment();

    await settleSubscriptionPayment({
      transaction,
      payment: { captured: true, id: transaction.razorpayPaymentId },
      resume: true,
    });
    const afterFirst = await Transaction.findById(transaction._id);
    await settleSubscriptionPayment({
      transaction: afterFirst,
      payment: { captured: true, id: afterFirst.razorpayPaymentId },
      resume: true,
    });

    const notices = await Notification.countDocuments({
      brandId: BRAND._id,
      "meta.subscribedId": { $exists: true },
    });
    expect(notices).toBe(1);
  });

  /** A first settle must be untouched by any of this. */
  it("still rejects a payment for a different order when not resuming", async () => {
    const transaction = await seedStrandedPayment({
      verified: false,
      settlementStage: undefined,
    });

    await expect(
      settleSubscriptionPayment({
        transaction,
        payment: {
          order_id: "order_SOMEONE_ELSE",
          amount: PRICING.amountInPaise,
          captured: true,
          id: "pay_X",
        },
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it("still rejects an amount mismatch when not resuming", async () => {
    const transaction = await seedStrandedPayment({
      verified: false,
      settlementStage: undefined,
    });

    await expect(
      settleSubscriptionPayment({
        transaction,
        payment: {
          order_id: transaction.razorpayOrderId,
          amount: 100,
          captured: true,
          id: "pay_X",
        },
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });
});

describe("a settlement whose document failed is not finished", () => {
  /**
   * ⚠️ The failure that made the alert pointless.
   *
   * The document block is caught so a settled payment is never failed over a
   * missing PDF — right. But the stage then advanced to INVOICED and COMPLETE
   * regardless, and COMPLETE is exactly what the sweep reads to decide there is
   * nothing left to do. So the alert fired, nobody could act on it
   * automatically, and the vendor kept a paid plan with no invoice until a human
   * re-issued it by hand.
   */
  it("stops the stage short so the sweep comes back for it", async () => {
    const transaction = await seedStrandedPayment();

    // The document cannot be numbered: an admin-chosen series that is not a
    // legal shape. This is a real failure mode, not an invented one.
    mockGenerateDocumentNumber = () => {
      throw new Error("document series is not usable");
    };

    const result = await settleSubscriptionPayment({
      transaction,
      payment: { captured: true, id: transaction.razorpayPaymentId },
      resume: true,
    });

    // The money and the plan are unaffected — that is why this must not throw.
    expect(result.subscribed).toBeTruthy();

    const after = await Transaction.findById(transaction._id);
    expect(after.invoiceId).toBeFalsy();
    expect(after.settlementStage).not.toBe(SETTLEMENT_STAGE.COMPLETE);
    expect(after.settlementStage).not.toBe(SETTLEMENT_STAGE.INVOICED);
  });

  it("is picked up again by the sweep, and finishes once the document works", async () => {
    const transaction = await seedStrandedPayment();

    mockGenerateDocumentNumber = () => {
      throw new Error("document series is not usable");
    };

    await settleSubscriptionPayment({
      transaction,
      payment: { captured: true, id: transaction.razorpayPaymentId },
      resume: true,
    });

    // Still outstanding, so the sweep sees it.
    expect((await resumeIncompleteSettlements()).found).toBe(1);

    // Whatever was wrong is fixed; the next sweep completes it.
    mockGenerateDocumentNumber = null;
    const repaired = await resumeIncompleteSettlements();
    expect(repaired.resumed).toBe(1);

    const after = await Transaction.findById(transaction._id);
    expect(after.invoiceId).toBeTruthy();
    expect(after.settlementStage).toBe(SETTLEMENT_STAGE.COMPLETE);
  });

  /** And it told somebody, rather than only leaving work behind. */
  it("alerts an admin about the missing document", async () => {
    const transaction = await seedStrandedPayment();
    mockGenerateDocumentNumber = () => {
      throw new Error("document series is not usable");
    };

    await settleSubscriptionPayment({
      transaction,
      payment: { captured: true, id: transaction.razorpayPaymentId },
      resume: true,
    });

    const alert = await Notification.findOne({
      type: NOTIFICATION_TYPES.WEBHOOK_FAILED,
    }).lean();
    expect(alert).toBeTruthy();
    expect(alert.title).toContain("Invoice could not be issued");
  });
});

describe("the sweep now covers both money flows", () => {
  it("picks up a stranded subscription payment", async () => {
    const transaction = await seedStrandedPayment();

    const result = await resumeIncompleteSettlements();

    expect(result.found).toBe(1);
    expect(result.resumed).toBe(1);
    expect(result.failed).toBe(0);

    const after = await Transaction.findById(transaction._id);
    expect(after.settlementStage).toBe(SETTLEMENT_STAGE.COMPLETE);
  });

  /**
   * `settlementStage != COMPLETE` is true of a **missing** field. An admin grant
   * never enters the staged pipeline and carries no stage at all, so without the
   * `$exists` guard the widened sweep would adopt every grant ever made and try
   * to settle it as a gateway payment.
   */
  it("leaves a transaction with no settlement stage alone", async () => {
    await seedStrandedPayment({ settlementStage: undefined });

    const result = await resumeIncompleteSettlements();
    expect(result.found).toBe(0);
  });

  it("leaves a completed settlement alone", async () => {
    await seedStrandedPayment({ settlementStage: SETTLEMENT_STAGE.COMPLETE });

    const result = await resumeIncompleteSettlements();
    expect(result.found).toBe(0);
  });

  /** Too recent to be stranded — it may simply still be in flight. */
  it("leaves a settlement that is still inside its window", async () => {
    await seedStrandedPayment({ verifiedAt: new Date() });

    const result = await resumeIncompleteSettlements();
    expect(result.found).toBe(0);
  });

  /**
   * ⚠️ One flow must not be able to hold the other's repair path hostage.
   *
   * A single shared `.limit(50)` let a bad afternoon on voucher claims fill
   * every slot, so a vendor whose subscription stranded waited behind fifty
   * claims on every tick for as long as the backlog lasted. The two flows have
   * nothing to do with each other.
   */
  it("gives each flow its own budget instead of one shared pool", async () => {
    // Three subscriptions, but a budget of one per flow.
    await Promise.all([
      seedStrandedPayment(),
      seedStrandedPayment(),
      seedStrandedPayment(),
    ]);

    const result = await resumeIncompleteSettlements({ perPurposeLimit: 1 });

    // One subscription taken, not three — and the slot is this flow's own, so a
    // claim backlog could not have consumed it.
    expect(result.found).toBe(1);
  });

  /**
   * The sweep is shared, but the settlers are not. Running a claim settler
   * against a subscription payment is how a customer's ₹760 gets settled against
   * a vendor's ₹4,999 plan.
   */
  it("routes a subscription to the subscription settler", async () => {
    const transaction = await seedStrandedPayment();

    await resumeIncompleteSettlements();

    // The proof it took the subscription path: a plan is live and the document
    // carries the subscription series. A claim settler would have thrown on the
    // missing VoucherClaim instead.
    const subscribed = await Subscribed.findOne({ transactionId: transaction._id });
    expect(subscribed).toBeTruthy();
    expect(subscribed.status).toBe(SUBSCRIBED_STATUS.ACTIVE);

    const after = await Transaction.findById(transaction._id);
    expect(after.invoiceId).toContain("/SUB/");
  });
});
