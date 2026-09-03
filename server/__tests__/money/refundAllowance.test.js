const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const RefundRequest = require("../../models/RefundRequest");
const {
  assertRefundAllowance,
  COUNTS_AGAINST_ALLOWANCE,
} = require("../../helpers/refunds");
const {
  REFUND_REQUEST_STATUS,
  REFUND_REASON,
} = require("../../constants/refund");
const { REFUND_DEFAULTS } = require("../../constants/customer");

const oid = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms);

let CUSTOMER;

const CONFIG = {
  maxOpenRequests: 1,
  maxRejectedPerWindow: 3,
  requestWindowDays: 30,
};

/**
 * `status` is set after creation on purpose.
 *
 * The `pre("save")` hook derives `isOpen` from `status`, and creating straight
 * into a terminal state would be a shape the real flow never produces — every
 * request starts as REQUESTED and is moved.
 */
const seedRequest = async ({
  status = REFUND_REQUEST_STATUS.REQUESTED,
  createdAt,
  customerId = CUSTOMER,
  transactionId = oid(),
} = {}) => {
  const doc = await RefundRequest.create({
    claimId: oid(),
    transactionId,
    customerId,
    brandId: oid(),
    claimCode: "TD-ACD349",
    requestedAmount: 810,
    reason: REFUND_REASON.NOT_HONOURED,
  });

  if (status !== REFUND_REQUEST_STATUS.REQUESTED) {
    doc.status = status;
    await doc.save();
  }
  if (createdAt) {
    await RefundRequest.collection.updateOne(
      { _id: doc._id },
      { $set: { createdAt } },
    );
  }
  return doc;
};

const allow = (overrides = {}) =>
  assertRefundAllowance({
    customerId: CUSTOMER,
    config: { ...CONFIG, ...overrides },
  });

beforeAll(async () => {
  await connectTestDb();
  await RefundRequest.createIndexes();
});

afterAll(async () => {
  await clearCollections(RefundRequest);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(RefundRequest);
  CUSTOMER = oid();
});

describe("an honest customer is never blocked", () => {
  /**
   * ⚠️ The point of the whole design.
   *
   * Counting raw requests would block the customer of the worst brand first —
   * and they are the one most entitled to ask. Five approved refunds means five
   * genuinely bad experiences, not five attempts at fraud.
   */
  it("does not count refunds that were approved", async () => {
    for (let i = 0; i < 5; i += 1) {
      await seedRequest({ status: REFUND_REQUEST_STATUS.COMPLETED });
    }

    await expect(allow()).resolves.toBeUndefined();
  });

  it("does not count a refund that is still being processed by us", async () => {
    await seedRequest({ status: REFUND_REQUEST_STATUS.COMPLETED });
    await seedRequest({ status: REFUND_REQUEST_STATUS.VENDOR_APPROVED });

    // The second one is open, so the open limit bites — but not the rejected one.
    await expect(allow({ maxOpenRequests: 5 })).resolves.toBeUndefined();
  });

  it("forgets a rejection once it falls out of the window", async () => {
    for (let i = 0; i < 3; i += 1) {
      await seedRequest({
        status: REFUND_REQUEST_STATUS.VENDOR_REJECTED,
        createdAt: ago(45 * DAY),
      });
    }

    await expect(allow()).resolves.toBeUndefined();
  });
});

describe("the refused ones are what count", () => {
  it("blocks after the configured number of rejections", async () => {
    for (let i = 0; i < 3; i += 1) {
      await seedRequest({ status: REFUND_REQUEST_STATUS.VENDOR_REJECTED });
    }

    await expect(allow()).rejects.toThrow(/not able to take this refund/i);
  });

  it("counts an admin rejection the same as a vendor's", async () => {
    await seedRequest({ status: REFUND_REQUEST_STATUS.VENDOR_REJECTED });
    await seedRequest({ status: REFUND_REQUEST_STATUS.ADMIN_REJECTED });
    await seedRequest({ status: REFUND_REQUEST_STATUS.ADMIN_REJECTED });

    await expect(allow()).rejects.toThrow(/not able to take this refund/i);
  });

  /**
   * Raise → the vendor sees it → withdraw → raise again is a way to keep a
   * vendor busy without ever collecting a rejection. Withdrawing once is
   * nothing; five times is the pattern this exists for.
   */
  it("counts a withdrawal, so raise-and-cancel cannot be used to spam", async () => {
    for (let i = 0; i < 3; i += 1) {
      await seedRequest({ status: REFUND_REQUEST_STATUS.CANCELLED });
    }

    await expect(allow()).rejects.toThrow(/not able to take this refund/i);
  });

  it("stops one short of the limit", async () => {
    await seedRequest({ status: REFUND_REQUEST_STATUS.VENDOR_REJECTED });
    await seedRequest({ status: REFUND_REQUEST_STATUS.CANCELLED });

    // Two of three. Still allowed.
    await expect(allow()).resolves.toBeUndefined();
  });

  it("counts only this customer's own", async () => {
    for (let i = 0; i < 5; i += 1) {
      await seedRequest({
        status: REFUND_REQUEST_STATUS.VENDOR_REJECTED,
        customerId: oid(),
      });
    }

    await expect(allow()).resolves.toBeUndefined();
  });
});

describe("how many can be in flight at once", () => {
  it("allows only the configured number open together", async () => {
    await seedRequest();
    await expect(allow()).rejects.toThrow(/already have a refund in progress/i);
  });

  it("counts a failed refund as still in flight", async () => {
    // The money still has to go back, and the request is what an admin retries
    // from — so it is open, and it occupies the slot.
    await seedRequest({ status: REFUND_REQUEST_STATUS.FAILED });
    await expect(allow()).rejects.toThrow(/already have a refund in progress/i);
  });

  /**
   * ⚠️ A second tap on the **same** claim is not a second request — the service
   * hands back the one already open. Counting it here would answer "you already
   * have a refund in progress" to somebody asking about that very refund.
   */
  it("does not count the caller's own payment", async () => {
    const txn = oid();
    await seedRequest({ transactionId: txn });

    await expect(
      assertRefundAllowance({
        customerId: CUSTOMER,
        config: CONFIG,
        exceptTransactionId: txn,
      }),
    ).resolves.toBeUndefined();
  });

  it("still counts a different claim's open request", async () => {
    await seedRequest({ transactionId: oid() });

    await expect(
      assertRefundAllowance({
        customerId: CUSTOMER,
        config: CONFIG,
        exceptTransactionId: oid(),
      }),
    ).rejects.toThrow(/already have a refund in progress/i);
  });
});

describe("what the customer is told", () => {
  /**
   * "You have been flagged" is both unpleasant and useless — they cannot act on
   * it, and if the flag is wrong there is nothing to correct it with. Handing
   * them a person to talk to is the only ending that works for the honest
   * customer and the dishonest one alike.
   */
  it("never accuses, and always names the next step", async () => {
    for (let i = 0; i < 3; i += 1) {
      await seedRequest({ status: REFUND_REQUEST_STATUS.VENDOR_REJECTED });
    }

    await expect(allow()).rejects.toThrow(/support/i);
    await expect(allow()).rejects.not.toThrow(
      /fraud|abuse|flagged|blocked|suspicious|denied/i,
    );
  });

  it("points at support when a refund is already in progress too", async () => {
    await seedRequest();
    await expect(allow()).rejects.toThrow(/support/i);
  });
});

describe("the config is a real switch", () => {
  it("is turned off by a zero", async () => {
    for (let i = 0; i < 10; i += 1) {
      await seedRequest({ status: REFUND_REQUEST_STATUS.VENDOR_REJECTED });
    }
    await seedRequest();

    await expect(
      allow({ maxOpenRequests: 0, maxRejectedPerWindow: 0 }),
    ).resolves.toBeUndefined();
  });

  it("widens when an admin raises the limit", async () => {
    for (let i = 0; i < 3; i += 1) {
      await seedRequest({ status: REFUND_REQUEST_STATUS.VENDOR_REJECTED });
    }

    await expect(allow()).rejects.toThrow();
    await expect(allow({ maxRejectedPerWindow: 10 })).resolves.toBeUndefined();
  });

  it("ships with limits that are actually set", () => {
    // A default of 0 would ship the feature switched off, which is worse than
    // not having it — nobody would notice until abuse was already happening.
    expect(REFUND_DEFAULTS.maxOpenRequests).toBeGreaterThan(0);
    expect(REFUND_DEFAULTS.maxRejectedPerWindow).toBeGreaterThan(0);
    expect(REFUND_DEFAULTS.requestWindowDays).toBeGreaterThan(0);
  });

  it("counts exactly the three refused states, and no success state", () => {
    expect([...COUNTS_AGAINST_ALLOWANCE].sort()).toEqual(
      [
        REFUND_REQUEST_STATUS.ADMIN_REJECTED,
        REFUND_REQUEST_STATUS.CANCELLED,
        REFUND_REQUEST_STATUS.VENDOR_REJECTED,
      ].sort(),
    );

    for (const good of [
      REFUND_REQUEST_STATUS.COMPLETED,
      REFUND_REQUEST_STATUS.VENDOR_APPROVED,
      REFUND_REQUEST_STATUS.ADMIN_APPROVED,
      REFUND_REQUEST_STATUS.PROCESSING,
    ]) {
      expect(COUNTS_AGAINST_ALLOWANCE).not.toContain(good);
    }
  });
});
