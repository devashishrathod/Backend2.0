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
const PromoCode = require("../../models/PromoCode");
const PromoCodeUsage = require("../../models/PromoCodeUsage");
const Notification = require("../../models/Notification");

const {
  TRANSACTION_PURPOSE,
  SETTLEMENT_STAGE,
} = require("../../constants/transaction");
const { VOUCHER_CLAIM_STATUS } = require("../../constants/voucherClaim");
const { LEDGER_ENTRY_TYPE } = require("../../constants/ledger");
const {
  PROMO_AUDIENCE,
  PROMO_DISCOUNT_TYPES,
  PROMO_USAGE_STATUS,
} = require("../../constants/promoCode");
const { VOUCHER_USAGE_TYPE } = require("../../constants/voucher");

const oid = () => new mongoose.Types.ObjectId();

/**
 * Razorpay, stubbed at the account boundary.
 *
 * These tests are about **our** ordering — which write lands before which, and
 * what happens when two callers reach the same line at once. The gateway is a
 * dependency of that story, not the subject of it, and reaching across the
 * network would make every one of them flaky for reasons that prove nothing.
 *
 * Named `mock*` because jest refuses a factory that closes over anything else.
 */
let mockOrdersCreate;
jest.mock("../../configs/razorpay", () => ({
  getRazorpayAccount: () => ({
    instance: { orders: { create: (...args) => mockOrdersCreate(...args) } },
    keyId: "rzp_test_lifecycle",
    keySecret: "secret",
  }),
  getRazorpayWebhookSecrets: () => ["secret"],
  isRazorpayAccountConfigured: () => true,
  describeRazorpayAccounts: () => [],
}));

/** The claim preview, stubbed so these tests need no voucher fixtures. */
let mockPreview;
jest.mock("../../helpers/vouchers", () => {
  const actual = jest.requireActual("../../helpers/vouchers");
  return { ...actual, buildClaimPreview: (...args) => mockPreview(...args) };
});

const {
  createVoucherClaimOrder,
} = require("../../services/voucherClaims");
const {
  settleVoucherClaimPayment,
} = require("../../helpers/voucherClaims");
const { getVendorBalance } = require("../../helpers/ledger");

const PRICING = {
  currency: "INR",
  billAmount: 1000,
  offerTitle: "20% off",
  offerDiscount: 200,
  netBill: 800,
  promoCode: null,
  promoDiscount: 0,
  vendorPromoCost: 0,
  platformPromoCost: 0,
  convenienceFee: 10,
  isGstEnabled: false,
  gstAmount: 0,
  taxType: null,
  totalPayable: 810,
  amountInPaise: 81000,
  youSaved: 200,
  vendorPayable: 800,
  commissionPercent: 0,
  commissionAmount: 0,
};

let CUSTOMER;
let BRAND;
let OFFER;
/**
 * The voucher and outlet a test is working against.
 *
 * Fixed per test rather than generated inside the preview, because two of the
 * things under test key on them: the reuse window looks for an open claim on the
 * **same** voucher and outlet, and the once-per-user index is
 * `{ voucherId, customerId, offerId }`. A preview handing back a fresh voucher
 * id each call would make both look like they work when neither had been
 * exercised at all.
 */
let VOUCHER;
let OUTLET;
let VERSION;

/** What `buildClaimPreview` hands back, including its `_internal` block. */
const previewFor = ({ pricing = PRICING, promoVerdict = null, promoCost = null } = {}) => ({
  voucher: { id: VOUCHER, name: "Test Voucher" },
  version: { id: VERSION, versionNumber: 1 },
  outlet: { id: OUTLET },
  brand: { id: BRAND, name: "test brand" },
  billAmount: pricing.billAmount,
  offerApplied: true,
  selectedOffer: null,
  eligibleOffers: [],
  pricing,
  orderSummary: { rows: [], payable: { amount: pricing.totalPayable } },
  promo: { supported: true, applied: null, provisional: false, message: null },
  canClaim: true,
  blockedReason: null,
  requiresLogin: false,
  notices: [],
  _internal: {
    config: { claim: { pendingOrderReuseMinutes: 10 } },
    voucher: { _id: VOUCHER, name: "Test Voucher", categoryId: oid(), subCategoryId: oid() },
    version: { _id: VERSION, versionNumber: 1 },
    outlet: { _id: OUTLET, uniqueId: "OUT-1", storeId: "T-01", locationId: { state: "MP" } },
    brand: { _id: BRAND, brandName: "test brand" },
    brandId: BRAND,
    offer: OFFER,
    promoVerdict,
    promoCost,
    customerId: CUSTOMER,
  },
});

const capturedPayment = (overrides = {}) => ({
  id: `pay_LC${Date.now()}${Math.floor(Math.random() * 1000)}`,
  captured: true,
  status: "captured",
  amount: PRICING.amountInPaise,
  fee: 1794,
  tax: 274,
  method: "upi",
  ...overrides,
});

const COLLECTIONS = [
  Transaction,
  VoucherClaim,
  VoucherClaimHistory,
  VoucherUsage,
  LedgerEntry,
  PromoCode,
  PromoCodeUsage,
  Notification,
];

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
  CUSTOMER = oid();
  BRAND = oid();
  VOUCHER = oid();
  OUTLET = oid();
  VERSION = oid();
  OFFER = { _id: oid(), title: "20% off", usageType: VOUCHER_USAGE_TYPE.ONCE_PER_USER };

  let counter = 0;
  mockOrdersCreate = async ({ amount, currency, receipt, notes }) => ({
    id: `order_LC${Date.now()}_${++counter}`,
    entity: "order",
    amount,
    currency,
    receipt,
    notes,
    status: "created",
    attempts: 0,
    created_at: Math.floor(Date.now() / 1000),
  });
  mockPreview = async () => previewFor();
});

const actor = () => ({ customerId: CUSTOMER, userId: oid(), role: "CUSTOMER" });

describe("one bill, one order — however many taps", () => {
  /**
   * Two payment sheets for one bill is the failure the whole ordering prevents.
   *
   * The idempotency key is inserted **before** the Razorpay call, so the unique
   * index decides which tap continues rather than the timing of two
   * read-then-write checks.
   */
  it("survives two concurrent taps with one key", async () => {
    const [a, b] = await Promise.allSettled([
      createVoucherClaimOrder(actor(), { billAmount: 1000 }, "idem-race"),
      createVoucherClaimOrder(actor(), { billAmount: 1000 }, "idem-race"),
    ]);

    const live = await Transaction.countDocuments({
      purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
      isDeleted: false,
    });
    expect(live).toBe(1);
    expect(await VoucherClaim.countDocuments({ isDeleted: false })).toBe(1);

    const orders = [a, b]
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value.razorpay.orderId);
    // Both callers get the same order — the loser is handed the winner's, not
    // an error.
    expect(new Set(orders).size).toBe(1);
  });

  it("hands back the same order on a sequential retry", async () => {
    const first = await createVoucherClaimOrder(actor(), { billAmount: 1000 }, "idem-1");
    const again = await createVoucherClaimOrder(actor(), { billAmount: 1000 }, "idem-1");

    expect(again.reused).toBe(true);
    expect(again.razorpay.orderId).toBe(first.razorpay.orderId);
  });

  /**
   * The reuse window catches the customer who simply reloads, with no key at
   * all — and it runs BEFORE the slot hold, so their own previous attempt is
   * not something they collide with.
   */
  it("reuses an open order when no key is sent", async () => {
    const first = await createVoucherClaimOrder(actor(), { billAmount: 1000 });
    const second = await createVoucherClaimOrder(actor(), { billAmount: 1000 });

    expect(second.reused).toBe(true);
    expect(second.razorpay.orderId).toBe(first.razorpay.orderId);
  });

  it("opens a new order for a different bill", async () => {
    // On a MULTIPLE offer. A once-per-user offer refuses the second claim
    // outright — correctly — so it cannot show whether the reuse window
    // distinguishes bills, which is what this is about.
    OFFER = { _id: oid(), title: "20% off", usageType: VOUCHER_USAGE_TYPE.MULTIPLE };

    const first = await createVoucherClaimOrder(actor(), { billAmount: 1000 });
    const other = await createVoucherClaimOrder(actor(), { billAmount: 1500 });

    expect(other.reused).toBe(false);
    expect(other.razorpay.orderId).not.toBe(first.razorpay.orderId);
  });
});

describe("a once-per-user offer is held from the moment the claim exists", () => {
  /**
   * Not from payment. Waiting for payment to take the lock leaves exactly the
   * window a race needs: two checkouts open, neither holding anything, both
   * allowed through.
   */
  it("refuses a second claim on the same offer", async () => {
    await createVoucherClaimOrder(actor(), { billAmount: 1000 });

    // Same customer, same offer, different bill so the reuse window does not
    // simply hand back the first order.
    await expect(
      createVoucherClaimOrder(actor(), { billAmount: 2000 }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("frees the slot again when the claim is cancelled", async () => {
    const first = await createVoucherClaimOrder(actor(), { billAmount: 1000 });
    await VoucherClaim.updateOne(
      { _id: first.claim.id },
      {
        $set: {
          status: VOUCHER_CLAIM_STATUS.CANCELLED,
          holdsUsageSlot: false,
        },
      },
    );

    const second = await createVoucherClaimOrder(actor(), { billAmount: 2000 });
    expect(second.claim.id).not.toBe(first.claim.id);
  });

  it("does not constrain an offer that is not once-per-user", async () => {
    OFFER = { _id: oid(), title: "20% off", usageType: VOUCHER_USAGE_TYPE.MULTIPLE };
    await createVoucherClaimOrder(actor(), { billAmount: 1000 });
    await createVoucherClaimOrder(actor(), { billAmount: 2000 });

    expect(await VoucherClaim.countDocuments({ isDeleted: false })).toBe(2);
  });
});

describe("a failure before the gateway leaves nothing behind", () => {
  /**
   * Razorpay is called last because it is the only step with no undo. Anything
   * that fails before it must leave no claim holding a slot nobody will pay for.
   */
  it("rolls the claim back when the order cannot be opened", async () => {
    mockOrdersCreate = async () => {
      throw new Error("Razorpay is down");
    };

    await expect(
      createVoucherClaimOrder(actor(), { billAmount: 1000 }),
    ).rejects.toThrow();

    // The claim exists for the audit trail, but holds nothing and is out of the
    // way.
    const claim = await VoucherClaim.findOne({});
    expect(claim.holdsUsageSlot).toBe(false);
    expect(claim.status).toBe(VOUCHER_CLAIM_STATUS.CANCELLED);
    expect(claim.isDeleted).toBe(true);

    // ...and the slot is genuinely free.
    mockOrdersCreate = async ({ amount, currency, receipt }) => ({
      id: `order_RETRY${Date.now()}`,
      entity: "order",
      amount,
      currency,
      receipt,
      status: "created",
    });
    const retry = await createVoucherClaimOrder(actor(), { billAmount: 1000 });
    expect(retry.razorpay.orderId).toBeTruthy();
  });

  it("releases the promo reservation too", async () => {
    const promo = await PromoCode.create({
      code: "LCFAIL",
      audience: PROMO_AUDIENCE.CUSTOMER,
      discountType: PROMO_DISCOUNT_TYPES.FLAT,
      discountAmount: 50,
      totalUsageLimit: 1,
    });
    mockPreview = async () =>
      previewFor({
        pricing: { ...PRICING, promoCode: "LCFAIL", promoDiscount: 50, totalPayable: 760 },
        promoVerdict: { ok: true, discount: 50, promoCode: promo },
        promoCost: { vendorCost: 0, platformCost: 50 },
      });
    mockOrdersCreate = async () => {
      throw new Error("Razorpay is down");
    };

    await expect(
      createVoucherClaimOrder(actor(), { billAmount: 1000 }),
    ).rejects.toThrow();

    // A single-use code must not be burned by an order that never opened.
    const after = await PromoCode.findById(promo._id);
    expect(after.usedCount).toBe(0);
    const usage = await PromoCodeUsage.findOne({});
    expect(usage?.status).not.toBe(PROMO_USAGE_STATUS.RESERVED);
  });
});

describe("create to settled, end to end", () => {
  it("leaves every record agreeing with every other", async () => {
    const order = await createVoucherClaimOrder(actor(), { billAmount: 1000 });
    const transaction = await Transaction.findById(order.transaction.id);

    const result = await settleVoucherClaimPayment({
      transaction,
      payment: capturedPayment(),
    });

    expect(result.alreadySettled).toBe(false);

    const claim = await VoucherClaim.findById(order.claim.id);
    const settled = await Transaction.findById(order.transaction.id);

    // The claim is redeemed and paid.
    expect(claim.status).toBe(VOUCHER_CLAIM_STATUS.REDEEMED);
    // The transaction is verified and fully staged.
    expect(settled.verified).toBe(true);
    expect(settled.settlementStage).toBe(SETTLEMENT_STAGE.COMPLETE);
    // The redemption is on the record exactly once.
    expect(await VoucherUsage.countDocuments({ voucherClaimId: claim._id })).toBe(1);
    // The vendor is owed what the pricing said, to the paisa.
    expect((await getVendorBalance(BRAND)).balance).toBe(PRICING.vendorPayable);
    // An invoice number was issued and a token minted, but no PDF rendered.
    expect(settled.invoiceId).toMatch(/^TD\/VCH\//);
    expect(settled.documentToken).toHaveLength(64);
    expect(settled.invoiceUrl).toBeFalsy();
    // Two audit rows: created, captured.
    expect(await VoucherClaimHistory.countDocuments({ claimId: claim._id })).toBe(2);
  });

  it("the money the vendor is owed never includes our fee", async () => {
    const order = await createVoucherClaimOrder(actor(), { billAmount: 1000 });
    const transaction = await Transaction.findById(order.transaction.id);
    await settleVoucherClaimPayment({ transaction, payment: capturedPayment() });

    const { balance } = await getVendorBalance(BRAND);
    // 810 was collected; 10 of it is ours.
    expect(balance).toBe(800);

    const fee = await LedgerEntry.findOne({
      entryType: LEDGER_ENTRY_TYPE.CONVENIENCE_FEE,
    });
    expect(fee.account).toBe("PLATFORM_REVENUE");
  });

  /**
   * The browser callback and the webhook fire within milliseconds of each other,
   * on every single payment.
   */
  it("credits the vendor once when both callers settle at the same moment", async () => {
    const order = await createVoucherClaimOrder(actor(), { billAmount: 1000 });
    const transaction = await Transaction.findById(order.transaction.id);
    const payment = capturedPayment();

    const [a, b] = await Promise.all([
      settleVoucherClaimPayment({ transaction, payment }),
      settleVoucherClaimPayment({ transaction, payment }),
    ]);

    expect([a, b].filter((r) => r.alreadySettled)).toHaveLength(1);
    expect((await getVendorBalance(BRAND)).balance).toBe(800);
    expect(await VoucherUsage.countDocuments({})).toBe(1);
    expect(
      await LedgerEntry.countDocuments({ entryType: LEDGER_ENTRY_TYPE.COLLECTION }),
    ).toBe(1);
  });

  it("commits the promo exactly once", async () => {
    const promo = await PromoCode.create({
      code: "LCPROMO",
      audience: PROMO_AUDIENCE.CUSTOMER,
      discountType: PROMO_DISCOUNT_TYPES.FLAT,
      discountAmount: 50,
    });
    mockPreview = async () =>
      previewFor({
        pricing: {
          ...PRICING,
          promoCode: "LCPROMO",
          promoDiscount: 50,
          platformPromoCost: 50,
          totalPayable: 760,
          amountInPaise: 76000,
        },
        promoVerdict: { ok: true, discount: 50, promoCode: promo },
        promoCost: { vendorCost: 0, platformCost: 50 },
      });

    const order = await createVoucherClaimOrder(actor(), { billAmount: 1000 });
    const transaction = await Transaction.findById(order.transaction.id);

    await settleVoucherClaimPayment({
      transaction,
      payment: capturedPayment({ amount: 76000 }),
    });

    const usage = await PromoCodeUsage.findOne({ transactionId: transaction._id });
    expect(usage.status).toBe(PROMO_USAGE_STATUS.CONSUMED);
    expect(await PromoCodeUsage.countDocuments({})).toBe(1);
    // The platform's share of the discount is on the books.
    const cost = await LedgerEntry.findOne({
      entryType: LEDGER_ENTRY_TYPE.PLATFORM_PROMO_COST,
    });
    expect(cost.amount).toBe(50);
  });

  /**
   * A resume runs the entire settle again. Nothing may double.
   */
  it("changes nothing when the whole settle is replayed", async () => {
    const order = await createVoucherClaimOrder(actor(), { billAmount: 1000 });
    const transaction = await Transaction.findById(order.transaction.id);
    await settleVoucherClaimPayment({ transaction, payment: capturedPayment() });

    const before = {
      balance: (await getVendorBalance(BRAND)).balance,
      ledger: await LedgerEntry.countDocuments({}),
      usage: await VoucherUsage.countDocuments({}),
      invoiceId: (await Transaction.findById(transaction._id)).invoiceId,
      notices: await Notification.countDocuments({}),
    };

    const settled = await Transaction.findById(transaction._id);
    await settleVoucherClaimPayment({
      transaction: settled,
      payment: capturedPayment(),
      resume: true,
    });

    expect((await getVendorBalance(BRAND)).balance).toBe(before.balance);
    expect(await LedgerEntry.countDocuments({})).toBe(before.ledger);
    expect(await VoucherUsage.countDocuments({})).toBe(before.usage);
    // No second invoice number — that would leave a hole in the series.
    expect((await Transaction.findById(transaction._id)).invoiceId).toBe(
      before.invoiceId,
    );
    // ...and the customer is not sent a second receipt.
    expect(await Notification.countDocuments({})).toBe(before.notices);
  });
});
