const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const RefundRequest = require("../../models/RefundRequest");
const Transaction = require("../../models/Transaction");
const {
  REFUND_REQUEST_STATUS,
  REFUND_OPEN_STATUSES,
  REFUND_HOLD_RELEASING_STATUSES,
  REFUND_REASON,
  REFUND_CUSTOMER_LABEL,
  REFUND_INDEXES,
} = require("../../constants/refund");
const { REFUND_STATUS } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();

let TXN;

const request = (overrides = {}) => ({
  claimId: oid(),
  transactionId: TXN,
  customerId: oid(),
  brandId: oid(),
  subBrandId: oid(),
  claimCode: "TD-ACD349",
  requestedAmount: 810,
  reason: REFUND_REASON.NOT_HONOURED,
  ...overrides,
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
  TXN = oid();
});

describe("one open request per payment", () => {
  /**
   * ⚠️ The race this exists for.
   *
   * A customer taps twice, or refreshes a page that looked stuck. Both requests
   * pass a read-then-write "is one already open?" check, and if both are later
   * approved the payment goes back **twice**. The unique index decides, not the
   * timing.
   */
  it("lets exactly one of two concurrent requests through", async () => {
    const results = await Promise.allSettled([
      RefundRequest.create(request()),
      RefundRequest.create(request()),
    ]);

    const created = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter(
      (r) => r.status === "rejected" && r.reason?.code === 11000,
    );

    expect(created).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // Named, so this cannot pass because some *other* unique index happened to
    // fire — 11000 alone says only "a uniqueness rule refused it".
    expect(rejected[0].reason.message).toContain(
      REFUND_INDEXES.ONE_OPEN_PER_TRANSACTION,
    );
  });

  /**
   * A customer refunded ₹300 in August may legitimately ask for another in
   * September. A blanket "one per payment" rule would refuse that forever, so
   * the index is partial on `isOpen`.
   */
  it("allows a second request once the first is settled", async () => {
    const first = await RefundRequest.create(request());
    first.status = REFUND_REQUEST_STATUS.COMPLETED;
    await first.save();

    const second = await RefundRequest.create(request({ requestedAmount: 200 }));
    expect(String(second.transactionId)).toBe(String(TXN));
  });

  it("still blocks while the first is only part-way through", async () => {
    const first = await RefundRequest.create(request());
    first.status = REFUND_REQUEST_STATUS.VENDOR_APPROVED;
    await first.save();

    await expect(RefundRequest.create(request())).rejects.toMatchObject({
      code: 11000,
      message: expect.stringContaining(REFUND_INDEXES.ONE_OPEN_PER_TRANSACTION),
    });
  });

  /**
   * `FAILED` is deliberately an **open** state: the money still has to go back,
   * and the request is what an admin retries from. Treating it as closed would
   * let a second request be filed against a payment already mid-refund.
   */
  it("treats a failed refund as still open", async () => {
    const first = await RefundRequest.create(request());
    first.status = REFUND_REQUEST_STATUS.FAILED;
    await first.save();

    expect(first.isOpen).toBe(true);
    await expect(RefundRequest.create(request())).rejects.toMatchObject({
      code: 11000,
    });
  });
});

describe("isOpen is derived, never set by hand", () => {
  /**
   * The unique index above depends on this flag. A stale `true` locks the
   * customer out of ever filing again; a stale `false` lets them file five. A
   * call site that can forget to update it is worse than no flag at all.
   */
  it("follows the status on every save", async () => {
    const req = await RefundRequest.create(request());
    expect(req.isOpen).toBe(true);

    for (const status of Object.values(REFUND_REQUEST_STATUS)) {
      req.status = status;
      await req.save();
      expect({ status, isOpen: req.isOpen }).toEqual({
        status,
        isOpen: REFUND_OPEN_STATUSES.includes(status),
      });
    }
  });

  it("overrides a wrong value written by a call site", async () => {
    // Somebody sets it by hand and gets it backwards.
    const req = await RefundRequest.create(
      request({ status: REFUND_REQUEST_STATUS.CANCELLED, isOpen: true }),
    );
    expect(req.isOpen).toBe(false);
  });
});

describe("the states that must release a settlement hold", () => {
  /**
   * ⚠️ The hold goes on the moment a refund is requested, so a refund can never
   * reach money already paid out. The cost is that a hold nobody releases keeps
   * a vendor's money out of **every future settlement** — silently, because the
   * eligibility predicate simply stops matching. There is no error to notice.
   */
  it("names exactly the terminal states where no money moves", () => {
    expect([...REFUND_HOLD_RELEASING_STATUSES].sort()).toEqual(
      [
        REFUND_REQUEST_STATUS.ADMIN_REJECTED,
        REFUND_REQUEST_STATUS.CANCELLED,
        REFUND_REQUEST_STATUS.VENDOR_REJECTED,
      ].sort(),
    );
  });

  /**
   * Both are absent on purpose, and for opposite reasons: after a failure the
   * money still has to go back, and after completion it is not the vendor's any
   * more. Releasing on either would pay a vendor for a claim that was refunded.
   */
  it("never releases on FAILED or COMPLETED", () => {
    expect(REFUND_HOLD_RELEASING_STATUSES).not.toContain(
      REFUND_REQUEST_STATUS.FAILED,
    );
    expect(REFUND_HOLD_RELEASING_STATUSES).not.toContain(
      REFUND_REQUEST_STATUS.COMPLETED,
    );
  });

  /**
   * A releasing state is by definition one nothing will move out of. If a state
   * were both open and releasing, the hold would come off while the request was
   * still live and the money could be settled away underneath it.
   */
  it("shares no state with the open list", () => {
    for (const status of REFUND_HOLD_RELEASING_STATUSES) {
      expect(REFUND_OPEN_STATUSES).not.toContain(status);
    }
  });
});

describe("razorpayRefundId uniqueness does not fire early", () => {
  /**
   * `$type: "string"` rather than `sparse: true`.
   *
   * Sparse still indexes an explicit `null`, so two requests created before
   * execution — both carrying no refund id — would collide on a rule that was
   * never meant to apply to them. That is the same bug the legacy `invoiceId_1`
   * index caused, and it actually fired in 1B.
   */
  it("lets several unexecuted requests coexist", async () => {
    const a = await RefundRequest.create(request());
    a.status = REFUND_REQUEST_STATUS.COMPLETED;
    await a.save();

    const b = await RefundRequest.create(request({ transactionId: oid() }));
    const c = await RefundRequest.create(request({ transactionId: oid() }));

    for (const row of [a, b, c]) {
      expect(row.razorpayRefundId).toBeUndefined();
    }
  });

  it("refuses to record the same Razorpay refund twice", async () => {
    await RefundRequest.create(
      request({ razorpayRefundId: "rfnd_MK1z9UcQ2Xa3bC" }),
    );

    // The executor running twice must lose on the index rather than issue a
    // second refund.
    await expect(
      RefundRequest.create(
        request({
          transactionId: oid(),
          razorpayRefundId: "rfnd_MK1z9UcQ2Xa3bC",
        }),
      ),
    ).rejects.toMatchObject({
      code: 11000,
      message: expect.stringContaining(REFUND_INDEXES.RAZORPAY_REFUND),
    });
  });
});

describe("the amounts stay honest", () => {
  it("keeps what was asked for separate from what was approved", async () => {
    const req = await RefundRequest.create(request({ requestedAmount: 810 }));
    req.approvedAmount = 400;
    req.status = REFUND_REQUEST_STATUS.VENDOR_APPROVED;
    await req.save();

    // The difference stays visible — an approval that lowers the amount is a
    // fact somebody may have to explain later.
    expect(req.requestedAmount).toBe(810);
    expect(req.approvedAmount).toBe(400);
  });
});

describe("the payment's own refund state", () => {
  /**
   * ⚠️ Without `PARTIAL`, a ₹300 refund on an ₹810 payment is written
   * `COMPLETED`, and from then on the row reads as fully refunded: settlement
   * skips it and the ₹510 still owed to the vendor is invisible.
   */
  it("has a state for partly refunded", () => {
    expect(REFUND_STATUS.PARTIAL).toBe("PARTIAL");
  });

  it("accepts PARTIAL on a transaction", async () => {
    const txn = await Transaction.create({
      purpose: "VOUCHER_CLAIM",
      gatewayAccount: "CUSTOMER",
      customerId: oid(),
      brandId: oid(),
      amount: 810,
      paidAmount: 810,
      amountRefunded: 300,
      refundStatus: REFUND_STATUS.PARTIAL,
    });

    expect(txn.refundStatus).toBe(REFUND_STATUS.PARTIAL);
    await Transaction.deleteOne({ _id: txn._id });
  });

  /**
   * The old field ref'd a `Refund` model that never existed. Mongoose only
   * raises that at `populate()` time, and nothing ever populated it — so it sat
   * looking valid for as long as it existed.
   */
  it("no longer carries the dangling refundId", () => {
    expect(Transaction.schema.path("refundId")).toBeUndefined();
    expect(Transaction.schema.path("latestRefundRequestId").options.ref).toBe(
      "RefundRequest",
    );
  });
});

describe("what the customer is told", () => {
  it("has a sentence for every state", () => {
    for (const status of Object.values(REFUND_REQUEST_STATUS)) {
      expect(REFUND_CUSTOMER_LABEL[status]).toBeTruthy();
    }
  });

  /**
   * Telling a customer the outlet ignored them starts a fight the platform then
   * has to referee, and it is not something they can act on.
   */
  it("never tells the customer the outlet went silent", () => {
    expect(REFUND_CUSTOMER_LABEL[REFUND_REQUEST_STATUS.VENDOR_TIMEOUT]).not.toMatch(
      /timeout|ignored|did not respond|no response/i,
    );
  });
});
