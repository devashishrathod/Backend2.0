const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const VoucherClaim = require("../../models/VoucherClaim");
const VoucherClaimHistory = require("../../models/VoucherClaimHistory");
const {
  generateClaimCode,
  randomClaimCode,
  recordClaimHistory,
  roleToPerformer,
} = require("../../helpers/voucherClaims");
const {
  VOUCHER_CLAIM_STATUS,
  CLAIM_HISTORY_ACTION,
  CLAIM_PERFORMED_BY,
  CLAIM_CODE,
} = require("../../constants/voucherClaim");
const { ROLES } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();

/** The minimum a claim needs to be valid. */
const claim = (overrides = {}) => ({
  customerId: oid(),
  voucherId: oid(),
  voucherVersionId: oid(),
  brandId: oid(),
  subBrandId: oid(),
  billAmount: 1000,
  pricing: { billAmount: 1000, totalPayable: 810, netBill: 800 },
  ...overrides,
});

beforeAll(async () => {
  await connectTestDb();
  // The indexes are what most of this file tests; build them before it runs.
  await VoucherClaim.createIndexes();
  await VoucherClaimHistory.createIndexes();
});

afterAll(async () => {
  await clearCollections(VoucherClaim, VoucherClaimHistory);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(VoucherClaim, VoucherClaimHistory);
});

describe("the once-per-user slot is held by the database", () => {
  /**
   * The lock is taken when the claim is **created**, not when it is paid.
   *
   * Waiting for payment leaves exactly the window a race needs: two checkouts
   * open at once, neither holding anything, both allowed through, and the
   * customer redeems a once-per-user offer twice.
   */
  it("lets exactly one of two concurrent claims hold the slot", async () => {
    const base = claim({ holdsUsageSlot: true, isOncePerUser: true, offerId: oid() });

    const results = await Promise.allSettled([
      VoucherClaim.create({ ...base }),
      VoucherClaim.create({ ...base }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.filter((r) => r.status === "rejected");
    expect(lost).toHaveLength(1);
    expect(lost[0].reason.code).toBe(11000);
  });

  it("is scoped per offer, not per voucher", async () => {
    const voucherId = oid();
    const customerId = oid();

    // A voucher carries several offers. Spending the 20%-off one does not spend
    // the free-dessert one.
    await VoucherClaim.create(
      claim({ voucherId, customerId, offerId: oid(), holdsUsageSlot: true, isOncePerUser: true }),
    );
    await VoucherClaim.create(
      claim({ voucherId, customerId, offerId: oid(), holdsUsageSlot: true, isOncePerUser: true }),
    );

    expect(await VoucherClaim.countDocuments({ voucherId, customerId })).toBe(2);
  });

  /**
   * A failed or refunded claim hands the slot back **without being deleted**.
   *
   * That is why the index keys on a boolean rather than on a status list: the
   * row stays, so the history of what happened stays, and the customer gets
   * their one use back.
   */
  it("frees the slot when the claim stops holding it", async () => {
    const base = claim({ holdsUsageSlot: true, isOncePerUser: true, offerId: oid() });
    const first = await VoucherClaim.create({ ...base });

    await expect(VoucherClaim.create({ ...base })).rejects.toMatchObject({
      code: 11000,
    });

    await VoucherClaim.updateOne(
      { _id: first._id },
      { $set: { holdsUsageSlot: false, status: VOUCHER_CLAIM_STATUS.FAILED } },
    );

    await VoucherClaim.create({ ...base });
    // Two rows: the failed one is still readable, and the new one holds the slot.
    expect(await VoucherClaim.countDocuments({ voucherId: base.voucherId })).toBe(2);
  });

  it("does not constrain a claim that holds no slot", async () => {
    const base = claim({ holdsUsageSlot: false, offerId: oid() });
    await VoucherClaim.create({ ...base });
    await VoucherClaim.create({ ...base });
    expect(await VoucherClaim.countDocuments({ voucherId: base.voucherId })).toBe(2);
  });

  /**
   * A claim with no offer — the bill was below every minimum.
   *
   * `offerId: null` is a real key in the index, so two such claims by the same
   * customer on the same voucher would collide **if either held a slot**. They
   * never do: `isOncePerUser` is false when no offer applied, so nothing holds.
   */
  it("lets a customer pay their bill on the same voucher repeatedly", async () => {
    const voucherId = oid();
    const customerId = oid();
    const base = { voucherId, customerId, offerId: null, holdsUsageSlot: false };

    await VoucherClaim.create(claim(base));
    await VoucherClaim.create(claim(base));
    await VoucherClaim.create(claim(base));

    expect(await VoucherClaim.countDocuments({ voucherId, customerId })).toBe(3);
  });
});

describe("one claim per transaction, one claim per code", () => {
  it("rejects a second claim on the same transaction", async () => {
    const transactionId = oid();
    await VoucherClaim.create(claim({ transactionId }));

    await expect(
      VoucherClaim.create(claim({ transactionId })),
    ).rejects.toMatchObject({ code: 11000 });
  });

  /**
   * A claim exists before its order does.
   *
   * `sparse` would still index the explicit null and make the second
   * order-less claim collide, which is the same bug the transaction collection
   * had on `invoiceId`. The partial `$type: "objectId"` filter is what keeps
   * them out of the index entirely.
   */
  it("allows many claims that have no transaction yet", async () => {
    await VoucherClaim.create(claim());
    await VoucherClaim.create(claim());
    await VoucherClaim.create(claim());

    expect(await VoucherClaim.countDocuments({ transactionId: null })).toBe(3);
  });

  it("rejects a duplicate claim code", async () => {
    const claimCode = "TD-ABC123";
    await VoucherClaim.create(claim({ claimCode }));

    await expect(VoucherClaim.create(claim({ claimCode }))).rejects.toMatchObject({
      code: 11000,
    });
  });

  it("allows many claims with no code yet", async () => {
    await VoucherClaim.create(claim());
    await VoucherClaim.create(claim());
    expect(await VoucherClaim.countDocuments({ claimCode: null })).toBe(2);
  });
});

describe("claim codes", () => {
  it("are shaped for reading aloud", () => {
    const code = randomClaimCode();
    expect(code).toMatch(
      new RegExp(`^${CLAIM_CODE.PREFIX}-[${CLAIM_CODE.ALPHABET}]{${CLAIM_CODE.LENGTH}}$`),
    );
  });

  it("omit the characters people mistype from a screen", () => {
    // 0/O, 1/I/L, 5/S, 2/Z, 8/B — this code is read across a counter.
    for (const ch of "01258OILSZB") {
      expect(CLAIM_CODE.ALPHABET).not.toContain(ch);
    }
  });

  it("do not repeat over a large sample", () => {
    const seen = new Set();
    for (let i = 0; i < 2000; i++) seen.add(randomClaimCode());
    expect(seen.size).toBe(2000);
  });

  it("skips a code that is already taken", async () => {
    // Fill the space the generator will look at by taking one it produces, then
    // prove it hands back something else.
    const taken = await generateClaimCode();
    await VoucherClaim.create(claim({ claimCode: taken }));

    const next = await generateClaimCode();
    expect(next).not.toBe(taken);
  });
});

describe("the audit trail never rolls back a payment", () => {
  it("records a transition", async () => {
    const claimId = oid();
    const row = await recordClaimHistory({
      claimId,
      customerId: oid(),
      brandId: oid(),
      action: CLAIM_HISTORY_ACTION.PAYMENT_CAPTURED,
      role: ROLES.CUSTOMER,
      fromStatus: VOUCHER_CLAIM_STATUS.PENDING,
      toStatus: VOUCHER_CLAIM_STATUS.PAID,
      amount: 810,
      snapshot: { razorpayPaymentId: "pay_TEST1" },
    });

    expect(row).toBeTruthy();
    expect(row.performedByRole).toBe(CLAIM_PERFORMED_BY.CUSTOMER);
    expect(row.snapshot.razorpayPaymentId).toBe("pay_TEST1");
    expect(await VoucherClaimHistory.countDocuments({ claimId })).toBe(1);
  });

  /**
   * The trade this helper exists to make.
   *
   * A customer whose payment succeeded but whose history row failed to save has
   * still been charged. Throwing here would unwind a settled payment over a
   * logging failure, so it returns null and logs instead.
   */
  it("returns null instead of throwing when the row is invalid", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});

    const row = await recordClaimHistory({
      // No claimId and no action — both required.
      customerId: oid(),
    });

    expect(row).toBeNull();
    // ...and it said so, loudly.
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("attributes a job to SYSTEM rather than guessing a user", () => {
    expect(roleToPerformer(undefined)).toBe(CLAIM_PERFORMED_BY.SYSTEM);
    expect(roleToPerformer(ROLES.ADMIN)).toBe(CLAIM_PERFORMED_BY.ADMIN);
    expect(roleToPerformer(ROLES.VENDOR)).toBe(CLAIM_PERFORMED_BY.VENDOR);
    expect(roleToPerformer(ROLES.SUB_VENDOR)).toBe(CLAIM_PERFORMED_BY.VENDOR);
    expect(roleToPerformer(ROLES.CUSTOMER)).toBe(CLAIM_PERFORMED_BY.CUSTOMER);
  });

  it("does not store the raw auth role as a column", async () => {
    const claimId = oid();
    await recordClaimHistory({
      claimId,
      action: CLAIM_HISTORY_ACTION.CLAIM_CREATED,
      role: ROLES.CUSTOMER,
    });
    const raw = await VoucherClaimHistory.collection.findOne({ claimId });
    // `role` is an input, not a field. Leaving it on the row would give two
    // columns saying the same thing, free to disagree.
    expect(raw.role).toBeUndefined();
    expect(raw.performedByRole).toBe(CLAIM_PERFORMED_BY.CUSTOMER);
  });
});
