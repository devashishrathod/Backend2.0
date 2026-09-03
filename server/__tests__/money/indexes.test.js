const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const VoucherUsage = require("../../models/VoucherUsage");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");

const oid = () => new mongoose.Types.ObjectId();

/**
 * The minimum a VoucherUsage needs to be valid.
 *
 * The redemption row is a denormalised snapshot — brand, version, amounts — so a
 * later report never has to join a voucher whose offers have since been edited.
 * That makes it required-heavy, and spelling it out here keeps each test to the
 * one field it is actually about.
 */
const usage = (overrides = {}) => ({
  voucherId: oid(),
  customerId: oid(),
  offerId: oid(),
  brandId: oid(),
  subBrandId: oid(),
  voucherVersionId: oid(),
  versionNumber: 1,
  transactionId: oid(),
  voucherClaimId: oid(),
  billAmount: 500,
  paidAmount: 450,
  isOncePerUser: false,
  isReversed: false,
  ...overrides,
});

/** The minimum a Transaction needs to be valid. */
const txn = (overrides = {}) => ({
  purpose: TRANSACTION_PURPOSE.SUBSCRIPTION,
  gatewayAccount: RAZORPAY_ACCOUNTS.VENDOR,
  amount: 100,
  ...overrides,
});

beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  await clearCollections(Transaction, VoucherUsage);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(Transaction, VoucherUsage);
});

describe("Transaction uniqueness is partial, not blanket", () => {
  /**
   * Test 4 — §2.3.
   *
   * `invoiceId` used to be `unique: true` on the path, which builds a plain
   * non-sparse unique index. Mongo indexes a missing field as `null`, so the
   * *second* document without an invoice collides with the first.
   *
   * Every voucher claim is created before its invoice exists. That single index
   * would therefore have failed every claim after the very first one on the
   * platform — and passed every test that only ever created one.
   */
  it("allows many transactions with no invoiceId yet", async () => {
    await Transaction.create(txn());
    await Transaction.create(txn());
    await Transaction.create(txn());

    expect(await Transaction.countDocuments({ invoiceId: null })).toBe(3);
  });

  it("still rejects two transactions sharing an invoice number", async () => {
    const invoiceId = "TD/SUB/26-27/000001";
    await Transaction.create(txn({ invoiceId }));

    await expect(Transaction.create(txn({ invoiceId }))).rejects.toMatchObject({
      code: 11000,
    });
  });

  it("allows many transactions with no razorpayOrderId (admin grants)", async () => {
    await Transaction.create(txn({ method: "MANUAL" }));
    await Transaction.create(txn({ method: "MANUAL" }));

    expect(await Transaction.countDocuments({ razorpayOrderId: null })).toBe(2);
  });

  it("still rejects a duplicate razorpayOrderId", async () => {
    const razorpayOrderId = "order_TEST000000001";
    await Transaction.create(txn({ razorpayOrderId }));

    await expect(
      Transaction.create(txn({ razorpayOrderId })),
    ).rejects.toMatchObject({ code: 11000 });
  });

  /**
   * Test 15 — §7 case 64.
   *
   * The idempotency key is scoped per customer, so two different customers
   * retrying with the same client-generated key do not collide, while one
   * customer double-tapping Pay gets a single transaction.
   */
  it("scopes the idempotency key per customer", async () => {
    const key = "idem-abcdef123456";
    const customerA = oid();
    const customerB = oid();

    await Transaction.create(
      txn({ customerId: customerA, idempotencyKey: key }),
    );
    // A different customer, same key — must be allowed.
    await Transaction.create(
      txn({ customerId: customerB, idempotencyKey: key }),
    );
    // The same customer again — must not.
    await expect(
      Transaction.create(txn({ customerId: customerA, idempotencyKey: key })),
    ).rejects.toMatchObject({ code: 11000 });

    expect(await Transaction.countDocuments({ idempotencyKey: key })).toBe(2);
  });

  it("does not constrain transactions that carry no idempotency key", async () => {
    const customerId = oid();
    await Transaction.create(txn({ customerId }));
    await Transaction.create(txn({ customerId }));

    expect(await Transaction.countDocuments({ customerId })).toBe(2);
  });

  /**
   * The race the partial index has to survive: two requests inserting the same
   * idempotency key at the same moment. Exactly one must win — a read-then-write
   * check would let both through.
   */
  it("survives two concurrent inserts of the same idempotency key", async () => {
    const customerId = oid();
    const key = "idem-race-000001";

    const results = await Promise.allSettled([
      Transaction.create(txn({ customerId, idempotencyKey: key })),
      Transaction.create(txn({ customerId, idempotencyKey: key })),
    ]);

    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");

    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0].reason.code).toBe(11000);
    expect(await Transaction.countDocuments({ idempotencyKey: key })).toBe(1);
  });
});

describe("VoucherUsage once-per-user is scoped per offer", () => {
  /**
   * Test 1 — §7 case 30.
   *
   * Two claims landing together on a once-per-user voucher. The guarantee is
   * enforced by a partial unique index rather than a read-then-write check,
   * because between the read and the write is exactly where the second claim
   * gets through.
   */
  it("lets exactly one of two concurrent claims through", async () => {
    const base = usage({ isOncePerUser: true });

    const results = await Promise.allSettled([
      VoucherUsage.create({ ...base, voucherClaimId: oid() }),
      VoucherUsage.create({ ...base, voucherClaimId: oid() }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.filter((r) => r.status === "rejected");
    expect(lost).toHaveLength(1);
    expect(lost[0].reason.code).toBe(11000);
  });

  /**
   * The scope is `(voucher, customer, offer)`, not `(voucher, customer)`.
   *
   * A voucher carries several offers. "Once per user" means once per *offer* —
   * a customer who redeemed the 20%-off offer can still redeem the free-dessert
   * one. A coarser index would silently deny them the second, and it would look
   * like a business rule rather than a bug.
   */
  it("still allows the same customer a different offer on the same voucher", async () => {
    const voucherId = oid();
    const customerId = oid();

    await VoucherUsage.create(
      usage({ voucherId, customerId, offerId: oid(), isOncePerUser: true }),
    );
    await VoucherUsage.create(
      usage({ voucherId, customerId, offerId: oid(), isOncePerUser: true }),
    );

    expect(await VoucherUsage.countDocuments({ voucherId, customerId })).toBe(2);
  });

  it("does not constrain a voucher that is not once-per-user", async () => {
    const base = usage({ isOncePerUser: false });

    await VoucherUsage.create({ ...base, voucherClaimId: oid() });
    await VoucherUsage.create({ ...base, voucherClaimId: oid() });

    expect(await VoucherUsage.countDocuments({ voucherId: base.voucherId })).toBe(2);
  });

  /**
   * A refund reverses the redemption, and the customer must get their one use
   * back. The index skips reversed rows, so the slot frees itself rather than
   * needing a delete — which would destroy the audit trail of what happened.
   */
  it("frees the slot again once the redemption is reversed", async () => {
    const base = usage({ isOncePerUser: true });

    const first = await VoucherUsage.create({ ...base, voucherClaimId: oid() });

    // Blocked while it stands.
    await expect(
      VoucherUsage.create({ ...base, voucherClaimId: oid() }),
    ).rejects.toMatchObject({ code: 11000 });

    await VoucherUsage.updateOne({ _id: first._id }, { $set: { isReversed: true } });

    // Allowed again, and the reversed row is still there to explain why.
    await VoucherUsage.create({ ...base, voucherClaimId: oid() });
    expect(await VoucherUsage.countDocuments({ voucherId: base.voucherId })).toBe(2);
  });

  it("allows only one usage row per claim", async () => {
    const voucherClaimId = oid();
    await VoucherUsage.create(usage({ voucherClaimId }));

    await expect(
      VoucherUsage.create(usage({ voucherClaimId })),
    ).rejects.toMatchObject({ code: 11000 });
  });
});
