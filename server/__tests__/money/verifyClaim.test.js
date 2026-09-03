const crypto = require("crypto");
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

const {
  verifyVoucherClaimPayment,
} = require("../../services/voucherClaims");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");
const { VOUCHER_CLAIM_STATUS } = require("../../constants/voucherClaim");
const { PAYMENT_GATEWAYS } = require("../../constants/subscription");

const oid = () => new mongoose.Types.ObjectId();

/**
 * A real secret for the CUSTOMER account, set here rather than read from `.env`.
 *
 * A test that depends on whichever key happens to be configured passes or fails
 * for reasons unrelated to the code, and would leak a real secret into a failure
 * message.
 */
const TEST_SECRET = "money-tests-customer-key-secret";
const saved = {};

const sign = (orderId, paymentId, secret = TEST_SECRET) =>
  crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");

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

const seedClaim = async () => {
  const customerId = oid();
  const brandId = oid();
  const orderId = `order_TEST${Date.now()}${Math.floor(Math.random() * 1000)}`;

  const transaction = await Transaction.create({
    purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
    gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
    gateway: PAYMENT_GATEWAYS.RAZORPAY,
    customerId,
    brandId,
    amount: PRICING.totalPayable,
    currency: "INR",
    verified: false,
    razorpayOrderId: orderId,
  });

  const claim = await VoucherClaim.create({
    customerId,
    voucherId: oid(),
    voucherVersionId: oid(),
    versionNumber: 1,
    brandId,
    subBrandId: oid(),
    billAmount: PRICING.billAmount,
    pricing: PRICING,
    transactionId: transaction._id,
    status: VOUCHER_CLAIM_STATUS.PENDING,
    claimCode: `TD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  });

  return { transaction, claim, customerId, brandId, orderId };
};

const COLLECTIONS = [
  Transaction,
  VoucherClaim,
  VoucherClaimHistory,
  VoucherUsage,
  LedgerEntry,
];

beforeAll(async () => {
  for (const key of ["RAZORPAY_CUSTOMER_SECRET", "RAZORPAY_CUSTOMER_KEY_ID"]) {
    saved[key] = process.env[key];
  }
  process.env.RAZORPAY_CUSTOMER_SECRET = TEST_SECRET;
  process.env.RAZORPAY_CUSTOMER_KEY_ID = "rzp_test_moneytests";

  await connectTestDb();
  for (const model of COLLECTIONS) await model.createIndexes();
});

afterAll(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await clearCollections(...COLLECTIONS);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(...COLLECTIONS);
});

describe("a signature alone is not enough", () => {
  /**
   * A valid signature proves Razorpay produced the payment. It says nothing
   * about which order it belongs to, how much arrived, or who is asking.
   */
  it("rejects a tampered signature", async () => {
    const { transaction, customerId, orderId } = await seedClaim();

    await expect(
      verifyVoucherClaimPayment(
        { customerId },
        {
          razorpayOrderId: orderId,
          razorpayPaymentId: "pay_TEST1",
          razorpaySignature: "0".repeat(64),
          transactionId: transaction._id,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects a signature made with the VENDOR account's secret", async () => {
    const { transaction, customerId, orderId } = await seedClaim();

    // The account is a fact about the transaction row, not a convention the
    // call site remembers. A vendor-signed callback must not settle a customer
    // claim even though the signature is genuine.
    await expect(
      verifyVoucherClaimPayment(
        { customerId },
        {
          razorpayOrderId: orderId,
          razorpayPaymentId: "pay_TEST1",
          razorpaySignature: sign(orderId, "pay_TEST1", "some-other-account-secret"),
          transactionId: transaction._id,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects an order id that does not match the transaction", async () => {
    const { transaction, customerId } = await seedClaim();

    await expect(
      verifyVoucherClaimPayment(
        { customerId },
        {
          razorpayOrderId: "order_SOMEONE_ELSE",
          razorpayPaymentId: "pay_TEST1",
          razorpaySignature: sign("order_SOMEONE_ELSE", "pay_TEST1"),
          transactionId: transaction._id,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
  });
});

describe("ownership is the customer, not the signed-in user", () => {
  /**
   * A claim belongs to a customer record. Checking `userId` would let a second
   * customer sharing a user account settle someone else's payment.
   */
  it("refuses another customer's payment", async () => {
    const { transaction, orderId } = await seedClaim();

    await expect(
      verifyVoucherClaimPayment(
        { customerId: oid() },
        {
          razorpayOrderId: orderId,
          razorpayPaymentId: "pay_TEST1",
          razorpaySignature: sign(orderId, "pay_TEST1"),
          transactionId: transaction._id,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("refuses an anonymous caller", async () => {
    const { transaction, orderId } = await seedClaim();

    await expect(
      verifyVoucherClaimPayment(
        {},
        {
          razorpayOrderId: orderId,
          razorpayPaymentId: "pay_TEST1",
          razorpaySignature: sign(orderId, "pay_TEST1"),
          transactionId: transaction._id,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  /**
   * `req.customerId` is a populated Customer document, not an id. A comparison
   * against `String(req.customerId)` would be `"[object Object]"` and never
   * match — locking every customer out of their own payment.
   */
  it("accepts a populated customer document, not just an id", async () => {
    const { transaction, customerId, orderId } = await seedClaim();

    // Same customer, handed over the way `authenticate.js` actually hands it.
    const asDocument = { _id: customerId, name: "test" };

    // Gets past ownership and fails later, on the gateway lookup — which proves
    // the ownership check itself passed.
    await expect(
      verifyVoucherClaimPayment(
        { customerId: asDocument },
        {
          razorpayOrderId: orderId,
          razorpayPaymentId: "pay_TEST1",
          razorpaySignature: sign(orderId, "pay_TEST1"),
          transactionId: transaction._id,
        },
      ),
    ).rejects.not.toMatchObject({ statusCode: 403 });
  });
});

describe("one money flow cannot reach the other", () => {
  /**
   * One collection holds both subscriptions and voucher claims. Looking a
   * transaction up by id alone would let a customer point this endpoint at a
   * vendor's subscription payment.
   */
  it("cannot verify a subscription transaction through the claim endpoint", async () => {
    const customerId = oid();
    const subscription = await Transaction.create({
      purpose: TRANSACTION_PURPOSE.SUBSCRIPTION,
      gatewayAccount: RAZORPAY_ACCOUNTS.VENDOR,
      gateway: PAYMENT_GATEWAYS.RAZORPAY,
      customerId,
      brandId: oid(),
      amount: 4999,
      verified: false,
      razorpayOrderId: "order_SUBSCRIPTION",
    });

    await expect(
      verifyVoucherClaimPayment(
        { customerId },
        {
          razorpayOrderId: "order_SUBSCRIPTION",
          razorpayPaymentId: "pay_TEST1",
          razorpaySignature: sign("order_SUBSCRIPTION", "pay_TEST1"),
          transactionId: subscription._id,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("does not find a soft-deleted transaction", async () => {
    const { transaction, customerId, orderId } = await seedClaim();
    await Transaction.updateOne({ _id: transaction._id }, { $set: { isDeleted: true } });

    await expect(
      verifyVoucherClaimPayment(
        { customerId },
        {
          razorpayOrderId: orderId,
          razorpayPaymentId: "pay_TEST1",
          razorpaySignature: sign(orderId, "pay_TEST1"),
          transactionId: transaction._id,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("a replay is a success, not an error", () => {
  /**
   * The webhook and the browser callback land within milliseconds of each
   * other. Whichever loses must not show the customer an error for a payment
   * that went through.
   */
  it("returns the settled claim without touching Razorpay again", async () => {
    const { transaction, claim, customerId, orderId } = await seedClaim();

    // The webhook already settled it.
    await Transaction.updateOne(
      { _id: transaction._id },
      { $set: { verified: true, verifiedAt: new Date() } },
    );
    await VoucherClaim.updateOne(
      { _id: claim._id },
      { $set: { status: VOUCHER_CLAIM_STATUS.REDEEMED } },
    );

    // No valid signature needed and no gateway call made — the fast path is
    // taken before either.
    const result = await verifyVoucherClaimPayment(
      { customerId },
      {
        razorpayOrderId: orderId,
        razorpayPaymentId: "pay_TEST1",
        razorpaySignature: "not-even-a-real-signature",
        transactionId: transaction._id,
      },
    );

    expect(result.alreadyVerified).toBe(true);
    expect(result.claim.status).toBe(VOUCHER_CLAIM_STATUS.REDEEMED);
  });

  it("still refuses another customer on the replay path", async () => {
    const { transaction, orderId } = await seedClaim();
    await Transaction.updateOne(
      { _id: transaction._id },
      { $set: { verified: true } },
    );

    // The fast path must not be a way around the ownership check.
    await expect(
      verifyVoucherClaimPayment(
        { customerId: oid() },
        {
          razorpayOrderId: orderId,
          razorpayPaymentId: "pay_TEST1",
          razorpaySignature: "irrelevant",
          transactionId: transaction._id,
        },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
