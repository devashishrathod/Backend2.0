const mongoose = require("mongoose");

const mockRefundFetch = jest.fn();
const mockPaymentFetch = jest.fn();

jest.mock("../../configs/razorpay", () => ({
  getRazorpayAccount: () => ({
    keyId: "rzp_test_x",
    instance: {
      refunds: { fetch: (...a) => mockRefundFetch(...a) },
      payments: { fetch: (...a) => mockPaymentFetch(...a) },
    },
  }),
}));

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const VoucherClaim = require("../../models/VoucherClaim");
const VoucherClaimHistory = require("../../models/VoucherClaimHistory");
const VoucherUsage = require("../../models/VoucherUsage");
const RefundRequest = require("../../models/RefundRequest");
const LedgerEntry = require("../../models/LedgerEntry");
const Setting = require("../../models/Setting");
const {
  escalateStaleRefunds,
  reconcileRefunds,
  remindVendorsAboutRefunds,
} = require("../../services/refunds");
const { getJobRegistry } = require("../../jobs");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");
const {
  VOUCHER_CLAIM_STATUS,
  CLAIM_HISTORY_ACTION,
  CLAIM_PERFORMED_BY,
} = require("../../constants/voucherClaim");
const {
  REFUND_REQUEST_STATUS,
  REFUND_REASON,
} = require("../../constants/refund");
const { VENDOR_TIMEOUT_ACTIONS } = require("../../constants/customer");
const { PAYMENT_STATUS } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();
const HOUR = 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms);
const ahead = (ms) => new Date(Date.now() + ms);

let CUSTOMER;
let BRAND;
let claim;
let txn;

const SPLIT = {
  totalRefund: 810,
  netBillRefund: 800,
  convenienceFeeRefund: 10,
  taxRefund: 0,
  vendorClawback: 800,
  platformPromoReversal: 0,
  vendorPromoReversal: 0,
  commissionReversal: 0,
  gatewayFeeAbsorbed: 17.94,
  isFullRefund: true,
};

const seed = async () => {
  const claimId = oid();

  txn = await Transaction.create({
    purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
    gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
    customerId: CUSTOMER,
    brandId: BRAND,
    subBrandId: oid(),
    amount: 810,
    paidAmount: 810,
    gatewayFee: 17.94,
    status: PAYMENT_STATUS.CAPTURED,
    verified: true,
    razorpayPaymentId: "pay_MK1z9UcQ2Xa3bC",
    settlementHold: true,
    voucher: { claimId, billAmount: 1000, netBill: 800 },
  });

  claim = await VoucherClaim.create({
    _id: claimId,
    customerId: CUSTOMER,
    voucherId: oid(),
    voucherVersionId: oid(),
    versionNumber: 1,
    brandId: BRAND,
    subBrandId: txn.subBrandId,
    billAmount: 1000,
    pricing: { netBill: 800, convenienceFee: 10, totalPayable: 810 },
    transactionId: txn._id,
    status: VOUCHER_CLAIM_STATUS.REDEEMED,
    claimCode: "TD-ACD349",
    holdsUsageSlot: true,
    voucherSnapshot: { name: "Test Voucher" },
  });
};

const seedRequest = async ({
  status = REFUND_REQUEST_STATUS.REQUESTED,
  vendorRespondBy = ahead(24 * HOUR),
  initiatedAt,
  razorpayRefundId,
  remindersSent = 0,
  /**
   * A second open request needs a second payment: `(transactionId, isOpen)` is
   * unique, so two open rows on one payment are refused by the index — which is
   * the whole point of it.
   */
  transactionId = txn._id,
} = {}) => {
  const doc = await RefundRequest.create({
    claimId: claim._id,
    transactionId,
    customerId: CUSTOMER,
    brandId: BRAND,
    subBrandId: txn.subBrandId,
    claimCode: "TD-ACD349",
    requestedAmount: 810,
    approvedAmount: 810,
    split: SPLIT,
    reason: REFUND_REASON.NOT_HONOURED,
    vendorRespondBy,
    remindersSent,
    ...(razorpayRefundId ? { razorpayRefundId } : {}),
    ...(initiatedAt ? { initiatedAt } : {}),
  });

  if (status !== REFUND_REQUEST_STATUS.REQUESTED) {
    doc.status = status;
    await doc.save();
  }
  return doc;
};

const setTimeoutAction = async (action) => {
  await Setting.findOneAndUpdate(
    {},
    { $set: { "customer.refund.onVendorTimeout": action } },
    { upsert: true, returnDocument: "after" },
  );
};

beforeAll(async () => {
  await connectTestDb();
  for (const m of [
    Transaction,
    VoucherClaim,
    VoucherClaimHistory,
    VoucherUsage,
    RefundRequest,
    LedgerEntry,
  ]) {
    await m.createIndexes();
  }
});

afterAll(async () => {
  await clearCollections(
    Transaction,
    VoucherClaim,
    VoucherClaimHistory,
    VoucherUsage,
    RefundRequest,
    LedgerEntry,
    Setting,
  );
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(
    Transaction,
    VoucherClaim,
    VoucherClaimHistory,
    VoucherUsage,
    RefundRequest,
    LedgerEntry,
    Setting,
  );
  mockRefundFetch.mockReset();
  mockPaymentFetch.mockReset();
  CUSTOMER = oid();
  BRAND = oid();
  await seed();
});

describe("a silent outlet cannot hold the money", () => {
  it("sends an overdue request to Trydood", async () => {
    const request = await seedRequest({ vendorRespondBy: ago(HOUR) });

    const result = await escalateStaleRefunds();

    expect(result).toMatchObject({ checked: 1, escalated: 1, autoApproved: 0 });
    const after = await RefundRequest.findById(request._id).lean();
    expect(after.status).toBe(REFUND_REQUEST_STATUS.VENDOR_TIMEOUT);
    // Still open — the money has to be decided on and then paid.
    expect(after.isOpen).toBe(true);
  });

  it("leaves a request whose window is still open", async () => {
    await seedRequest({ vendorRespondBy: ahead(HOUR) });

    const result = await escalateStaleRefunds();
    expect(result).toMatchObject({ checked: 0, escalated: 0 });
  });

  /**
   * A timeout is not a rejection. The money is still owed until somebody
   * decides, so only a terminal *no* releases the hold.
   */
  it("does not release the settlement hold", async () => {
    await seedRequest({ vendorRespondBy: ago(HOUR) });
    await escalateStaleRefunds();

    const after = await Transaction.findById(txn._id).lean();
    expect(after.settlementHold).toBe(true);
  });

  it("approves automatically when configured to", async () => {
    await setTimeoutAction(VENDOR_TIMEOUT_ACTIONS.AUTO_APPROVE);
    const request = await seedRequest({ vendorRespondBy: ago(HOUR) });

    const result = await escalateStaleRefunds();

    expect(result).toMatchObject({ escalated: 0, autoApproved: 1 });
    const after = await RefundRequest.findById(request._id).lean();
    expect(after.status).toBe(REFUND_REQUEST_STATUS.VENDOR_APPROVED);
    expect(after.approvedAmount).toBe(810);
  });

  it("does not look at a request the vendor has already decided", async () => {
    const request = await seedRequest({ vendorRespondBy: ago(HOUR) });
    await RefundRequest.updateOne(
      { _id: request._id },
      { $set: { status: REFUND_REQUEST_STATUS.VENDOR_REJECTED, isOpen: false } },
    );

    const result = await escalateStaleRefunds();

    expect(result.escalated).toBe(0);
    expect((await RefundRequest.findById(request._id).lean()).status).toBe(
      REFUND_REQUEST_STATUS.VENDOR_REJECTED,
    );
  });

  /**
   * ⚠️ The window the conditional claim actually exists for.
   *
   * The query above only proves a row already decided is not *selected*. The
   * real race is narrower: the vendor clicks **between** the sweep reading the
   * batch and writing to it. Two instances running together hit the same window,
   * and the job lock only covers the common case.
   *
   * Reproduced deterministically by flipping the second request while the first
   * one is still being processed — so the sweep is holding a batch that has gone
   * stale underneath it, which is exactly the production shape.
   */
  it("never overwrites a decision made while the sweep is running", async () => {
    const first = await seedRequest({ vendorRespondBy: ago(2 * HOUR) });
    const second = await seedRequest({
      vendorRespondBy: ago(HOUR),
      transactionId: oid(),
    });

    /**
     * Patched on the **model**, not on a destructured helper.
     *
     * `refundJobs.js` does `const { recordClaimHistory } = require(...)` at
     * import time, so reassigning that property later changes nothing — the
     * binding was already captured. `RefundRequest.findOneAndUpdate` is looked
     * up at call time, so this one actually takes effect.
     */
    const original = RefundRequest.findOneAndUpdate.bind(RefundRequest);
    let flipped = false;

    RefundRequest.findOneAndUpdate = function patched(filter, ...rest) {
      const query = original(filter, ...rest);
      if (flipped || String(filter?._id) !== String(first._id)) return query;

      flipped = true;
      /**
       * Only `.lean()` is wrapped, so the caller still gets a Mongoose Query
       * back. Returning a bare Promise here broke it — the service chains
       * `.lean()` onto the result, which a Promise does not have.
       */
      const realLean = query.lean.bind(query);
      query.lean = () =>
        RefundRequest.collection
          .updateOne(
            { _id: second._id },
            {
              $set: {
                status: REFUND_REQUEST_STATUS.VENDOR_REJECTED,
                isOpen: false,
              },
            },
          )
          // The vendor's answer on `second` lands while `first` is mid-flight.
          .then(() => realLean());
      return query;
    };

    try {
      const result = await escalateStaleRefunds();

      // The first was escalated; the second was decided under the sweep's feet
      // and must be left exactly as the vendor left it.
      expect(result.checked).toBe(2);
      expect(result.escalated).toBe(1);
      expect((await RefundRequest.findById(first._id).lean()).status).toBe(
        REFUND_REQUEST_STATUS.VENDOR_TIMEOUT,
      );
      expect((await RefundRequest.findById(second._id).lean()).status).toBe(
        REFUND_REQUEST_STATUS.VENDOR_REJECTED,
      );
    } finally {
      RefundRequest.findOneAndUpdate = original;
    }
  });

  it("records the escalation as the system's doing, not a person's", async () => {
    await seedRequest({ vendorRespondBy: ago(HOUR) });
    await escalateStaleRefunds();

    const rows = await VoucherClaimHistory.find({ claimId: claim._id }).lean();
    const row = rows.find(
      (r) => r.action === CLAIM_HISTORY_ACTION.REFUND_ESCALATED,
    );

    expect(row).toBeTruthy();
    expect(row.performedByRole).toBe(CLAIM_PERFORMED_BY.SYSTEM);
    expect(row.performedBy).toBeUndefined();
  });
});

describe("refunds that never came back from Razorpay", () => {
  const inFlight = () =>
    seedRequest({
      status: REFUND_REQUEST_STATUS.PROCESSING,
      razorpayRefundId: "rfnd_MK1z9UcQ2Xa3bC",
      initiatedAt: ago(4 * HOUR),
    });

  /**
   * ⚠️ A lost `refund.processed` leaves the customer with their money, the
   * claim still redeemed, the once-per-user slot still held and no ledger row.
   * Nothing about that state says anything is wrong.
   */
  it("completes one Razorpay says is processed", async () => {
    const request = await inFlight();
    mockRefundFetch.mockResolvedValue({
      id: "rfnd_MK1z9UcQ2Xa3bC",
      status: "processed",
      acquirer_data: { arn: "10000000000000" },
    });
    mockPaymentFetch.mockResolvedValue({ amount_refunded: 81000 });

    const result = await reconcileRefunds();

    expect(result).toMatchObject({ checked: 1, completed: 1 });
    const after = await RefundRequest.findById(request._id).lean();
    expect(after.status).toBe(REFUND_REQUEST_STATUS.COMPLETED);
    expect(after.utr).toBe("10000000000000");

    // And everything downstream ran — the slot is back.
    const claimAfter = await VoucherClaim.findById(claim._id).lean();
    expect(claimAfter.holdsUsageSlot).toBe(false);
  });

  it("marks one Razorpay says failed, and leaves it open", async () => {
    const request = await inFlight();
    mockRefundFetch.mockResolvedValue({
      status: "failed",
      status_reason: "Instrument cannot accept a refund",
    });

    const result = await reconcileRefunds();

    expect(result).toMatchObject({ failed: 1 });
    const after = await RefundRequest.findById(request._id).lean();
    expect(after.status).toBe(REFUND_REQUEST_STATUS.FAILED);
    // The money has not gone back, so both stay put.
    expect(after.isOpen).toBe(true);
    const txnAfter = await Transaction.findById(txn._id).lean();
    expect(txnAfter.settlementHold).toBe(true);
  });

  it("leaves one that is genuinely still in flight alone", async () => {
    await inFlight();
    mockRefundFetch.mockResolvedValue({ status: "pending" });

    const result = await reconcileRefunds();
    expect(result).toMatchObject({ stillPending: 1, completed: 0, failed: 0 });
  });

  /**
   * A gateway that cannot be reached is not a failed refund. Counted so a
   * rising number is visible, and the row left exactly as it was.
   */
  it("does not turn an unreachable gateway into a failure", async () => {
    const request = await inFlight();
    mockRefundFetch.mockRejectedValue(new Error("gateway down"));

    const result = await reconcileRefunds();

    expect(result).toMatchObject({ unreachable: 1, failed: 0, completed: 0 });
    const after = await RefundRequest.findById(request._id).lean();
    expect(after.status).toBe(REFUND_REQUEST_STATUS.PROCESSING);
  });

  it("gives the gateway a head start before calling anything stuck", async () => {
    await seedRequest({
      status: REFUND_REQUEST_STATUS.PROCESSING,
      razorpayRefundId: "rfnd_justnow",
      initiatedAt: new Date(),
    });

    const result = await reconcileRefunds();
    expect(result.checked).toBe(0);
    expect(mockRefundFetch).not.toHaveBeenCalled();
  });

  it("records the completion even when the payment lookup fails", async () => {
    const request = await inFlight();
    mockRefundFetch.mockResolvedValue({ id: "rfnd_x", status: "processed" });
    // Best-effort: a failure here must not stop a completed refund being recorded.
    mockPaymentFetch.mockRejectedValue(new Error("nope"));

    const result = await reconcileRefunds();

    expect(result.completed).toBe(1);
    const after = await RefundRequest.findById(request._id).lean();
    expect(after.status).toBe(REFUND_REQUEST_STATUS.COMPLETED);
  });
});

describe("the vendor is nudged before the window closes", () => {
  /** Halfway through a 24-hour window: one mark passed, one nudge owed. */
  const halfway = () => seedRequest({ vendorRespondBy: ahead(12 * HOUR) });

  it("sends a reminder once the halfway mark passes", async () => {
    await halfway();

    const result = await remindVendorsAboutRefunds();
    expect(result.sent).toBe(1);
  });

  it("does not nudge a request that has barely started", async () => {
    await seedRequest({ vendorRespondBy: ahead(23 * HOUR) });

    const result = await remindVendorsAboutRefunds();
    expect(result.sent).toBe(0);
  });

  it("does not repeat a nudge the row has already had", async () => {
    await halfway();

    await remindVendorsAboutRefunds();
    const second = await remindVendorsAboutRefunds();

    expect(second.sent).toBe(0);
  });

  /**
   * ⚠️ At most **one** nudge per row per sweep.
   *
   * An earlier version looped both marks in one pass with a `$lte` filter, and a
   * request already close to its deadline matched both — the second query
   * re-read the row the first had just bumped and fired again. The outlet got
   * two identical reminders a millisecond apart, which reads as a broken system
   * rather than a helpful one.
   */
  it("sends the second nudge on the next sweep, never two at once", async () => {
    // Both marks are already behind this one.
    await seedRequest({ vendorRespondBy: ahead(2 * HOUR) });

    const first = await remindVendorsAboutRefunds();
    const second = await remindVendorsAboutRefunds();
    const third = await remindVendorsAboutRefunds();

    expect(first.sent).toBe(1);
    expect(second.sent).toBe(1);
    // Two marks, two nudges, and then it stops.
    expect(third.sent).toBe(0);
  });

  /**
   * ⚠️ The window the conditional update exists for.
   *
   * Two instances reading the same batch at the same moment — which is why
   * `remindersSent` is bumped in the very update that claims the row, with the
   * expected value in the filter, rather than checked first and written after.
   */
  it("sends once when two sweeps run at the same moment", async () => {
    await halfway();

    const [a, b] = await Promise.all([
      remindVendorsAboutRefunds(),
      remindVendorsAboutRefunds(),
    ]);

    expect(a.sent + b.sent).toBe(1);
  });

  it("does not nudge a request whose window has already closed", async () => {
    await seedRequest({ vendorRespondBy: ago(HOUR) });

    const result = await remindVendorsAboutRefunds();
    // Past the deadline is the escalation job's problem, not a reminder's.
    expect(result.sent).toBe(0);
  });
});

describe("the runner knows about them", () => {
  it("registers all three", () => {
    const names = getJobRegistry().map((j) => j.name);

    expect(names).toContain("escalateStaleRefunds");
    expect(names).toContain("reconcileRefunds");
    expect(names).toContain("remindVendorsAboutRefunds");
  });

  /**
   * Registered rather than started with a bare `setInterval`: the runner is an
   * in-process timer, so anything scheduled outside it runs once per instance on
   * a multi-instance deploy. Going through the registry buys the cross-process
   * lock and the health record.
   *
   * `getJobRegistry()` reports the interval each job was **scheduled** at, which
   * is `null` here because the runner is not started in a test — so what is
   * asserted is that the health surface can see them at all, and that nothing
   * appears twice.
   */
  it("exposes each of them to the health surface exactly once", () => {
    const names = getJobRegistry().map((j) => j.name);
    const duplicated = names.filter((n, i) => names.indexOf(n) !== i);

    expect(duplicated).toEqual([]);
    for (const name of [
      "escalateStaleRefunds",
      "reconcileRefunds",
      "remindVendorsAboutRefunds",
    ]) {
      expect(names.filter((n) => n === name)).toHaveLength(1);
    }
  });
});

describe("the hold an open refund must always have", () => {
  /**
   * ⚠️ `requestRefund` sets the hold, but as a second round trip after the
   * request is created. A process that dies in between leaves an open refund
   * whose money is still eligible for payout — and settlement then pays the
   * vendor for a claim that is about to be refunded.
   *
   * Repaired rather than merely reported: the window between noticing and fixing
   * is a settlement run.
   */
  it("puts back a hold that never landed", async () => {
    await Transaction.updateOne(
      { _id: txn._id },
      { $set: { settlementHold: false } },
    );
    await seedRequest();

    const result = await reconcileRefunds();

    expect(result.holdsRepaired).toBe(1);
    const after = await Transaction.findById(txn._id).lean();
    expect(after.settlementHold).toBe(true);
    expect(after.settlementHoldReason).toMatch(/re-applied by reconcile/i);
  });

  it("leaves a hold that is already on alone", async () => {
    await seedRequest();

    const result = await reconcileRefunds();
    expect(result.holdsRepaired).toBe(0);
  });

  /**
   * A closed refund's hold is *supposed* to be off — re-applying it would strand
   * the vendor's money for a refund that is not happening.
   */
  it("never re-applies a hold for a closed refund", async () => {
    await Transaction.updateOne(
      { _id: txn._id },
      { $set: { settlementHold: false } },
    );
    await seedRequest({ status: REFUND_REQUEST_STATUS.VENDOR_REJECTED });

    const result = await reconcileRefunds();

    expect(result.holdsRepaired).toBe(0);
    expect((await Transaction.findById(txn._id).lean()).settlementHold).toBe(false);
  });
});
