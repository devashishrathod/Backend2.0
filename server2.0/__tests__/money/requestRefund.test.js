const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const VoucherClaim = require("../../models/VoucherClaim");
const VoucherClaimHistory = require("../../models/VoucherClaimHistory");
const RefundRequest = require("../../models/RefundRequest");
const Setting = require("../../models/Setting");
const { requestRefund } = require("../../services/refunds");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");
const {
  VOUCHER_CLAIM_STATUS,
  CLAIM_HISTORY_ACTION,
} = require("../../constants/voucherClaim");
const {
  REFUND_REQUEST_STATUS,
  REFUND_REASON,
} = require("../../constants/refund");
const { ROLES, PAYMENT_STATUS } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();
const HOUR = 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms);

let CUSTOMER;
let BRAND;
let claim;
let txn;

const customer = (id = CUSTOMER) => ({
  role: ROLES.CUSTOMER,
  customerId: id,
  userId: oid(),
});

const PRICING = {
  billAmount: 1000,
  offerDiscount: 200,
  netBill: 800,
  convenienceFee: 10,
  promoDiscount: 0,
  vendorPromoCost: 0,
  platformPromoCost: 0,
  commissionAmount: 0,
  taxOnTop: 0,
  totalPayable: 810,
  amountInPaise: 81000,
  youSaved: 200,
  vendorPayable: 800,
};

const seed = async ({ paidAt = new Date(), status = VOUCHER_CLAIM_STATUS.REDEEMED, verified = true } = {}) => {
  const claimId = oid();

  const transaction = await Transaction.create({
    purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
    gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
    customerId: CUSTOMER,
    brandId: BRAND,
    subBrandId: oid(),
    amount: 810,
    paidAmount: 810,
    gatewayFee: 17.94,
    status: PAYMENT_STATUS.CAPTURED,
    verified,
    verifiedAt: paidAt,
    voucher: { claimId, billAmount: 1000, netBill: 800, convenienceFee: 10 },
  });

  const claimDoc = await VoucherClaim.create({
    _id: claimId,
    customerId: CUSTOMER,
    voucherId: oid(),
    voucherVersionId: oid(),
    versionNumber: 1,
    brandId: BRAND,
    subBrandId: transaction.subBrandId,
    billAmount: 1000,
    pricing: PRICING,
    transactionId: transaction._id,
    status,
    paidAt,
    claimCode: `TD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    voucherSnapshot: { name: "Test Voucher" },
  });

  return { transaction, claim: claimDoc };
};

const ask = (overrides = {}) =>
  requestRefund(customer(), {
    claimId: claim._id,
    reason: REFUND_REASON.NOT_HONOURED,
    ...overrides,
  });

beforeAll(async () => {
  await connectTestDb();
  for (const m of [Transaction, VoucherClaim, VoucherClaimHistory, RefundRequest]) {
    await m.createIndexes();
  }
});

afterAll(async () => {
  await clearCollections(
    Transaction,
    VoucherClaim,
    VoucherClaimHistory,
    RefundRequest,
    Setting,
  );
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(
    Transaction,
    VoucherClaim,
    VoucherClaimHistory,
    RefundRequest,
    Setting,
  );
  CUSTOMER = oid();
  BRAND = oid();
  ({ transaction: txn, claim } = await seed());
});

describe("the customer asks for their money back", () => {
  it("opens a request for the whole payment by default", async () => {
    const result = await ask();

    // Not making them restate a figure the server already knows is how it stops
    // being typed wrong.
    expect(result.amount).toBe(810);
    expect(result.status).toBe(REFUND_REQUEST_STATUS.REQUESTED);
    expect(result.isOpen).toBe(true);
    expect(result.claimCode).toBe(claim.claimCode);
  });

  it("freezes the split at request time", async () => {
    await ask();
    const stored = await RefundRequest.findOne({ transactionId: txn._id }).lean();

    // A refund approved on Tuesday and paid on Thursday must move exactly what
    // everyone agreed to on Tuesday.
    expect(stored.split.totalRefund).toBe(810);
    expect(stored.split.vendorClawback).toBe(800);
    expect(stored.split.convenienceFeeRefund).toBe(10);
    expect(stored.split.gatewayFeeAbsorbed).toBe(17.94);
    expect(stored.split.isFullRefund).toBe(true);
  });

  it("accepts a partial amount", async () => {
    const result = await ask({ amount: 300 });
    const stored = await RefundRequest.findOne({ transactionId: txn._id }).lean();

    expect(result.amount).toBe(300);
    expect(stored.split.isFullRefund).toBe(false);
    // A partial comes out of the vendor side; our fee stays with us.
    expect(stored.split.convenienceFeeRefund).toBe(0);
  });

  it("sets the vendor's own deadline on the row", async () => {
    await ask();
    const stored = await RefundRequest.findOne({ transactionId: txn._id }).lean();

    // Stored rather than computed at read time — raising the setting tomorrow
    // must not silently extend a request already waiting on today's promise.
    expect(stored.vendorRespondBy).toBeInstanceOf(Date);
    expect(stored.vendorRespondBy.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("the settlement hold", () => {
  /**
   * ⚠️ The one line that removes the whole "we already paid the vendor, now
   * claw it back" problem. The row drops out of every settlement until the
   * refund reaches a terminal state.
   */
  it("goes on the moment a refund is requested", async () => {
    const before = await Transaction.findById(txn._id).lean();
    expect(before.settlementHold).toBe(false);

    await ask();

    const after = await Transaction.findById(txn._id).lean();
    expect(after.settlementHold).toBe(true);
    expect(after.settlementHoldReason).toMatch(/refund requested/i);
  });

  it("points the payment at the request that caused it", async () => {
    const result = await ask();
    const after = await Transaction.findById(txn._id).lean();

    expect(String(after.latestRefundRequestId)).toBe(String(result._id));
  });
});

describe("one request per payment, whatever the customer taps", () => {
  /**
   * Two taps, or a refreshed page. Both pass the read-then-write check above
   * the insert; the unique index is what settles it.
   */
  it("survives two concurrent asks", async () => {
    const [a, b] = await Promise.all([ask(), ask()]);

    const all = await RefundRequest.find({ transactionId: txn._id }).lean();
    expect(all).toHaveLength(1);

    // Both callers get an answer they can act on — from the customer's side the
    // outcome is identical, they asked once.
    expect(String(a._id)).toBe(String(b._id));
    expect(a.reused || b.reused).toBe(true);
  });

  it("hands back the open request on a sequential retry", async () => {
    const first = await ask();
    const second = await ask({ amount: 100 });

    expect(String(second._id)).toBe(String(first._id));
    expect(second.reused).toBe(true);
    // The original amount stands — a retry is not a new decision.
    expect(second.amount).toBe(810);
  });
});

describe("what it refuses", () => {
  it("refuses another customer's claim", async () => {
    await expect(
      requestRefund(customer(oid()), {
        claimId: claim._id,
        reason: REFUND_REASON.NOT_HONOURED,
      }),
    ).rejects.toThrow(/not authorized/i);
  });

  it("refuses a guest", async () => {
    await expect(
      requestRefund({}, { claimId: claim._id, reason: REFUND_REASON.NOT_HONOURED }),
    ).rejects.toThrow(/log in/i);
  });

  /**
   * The status is named back. "This claim cannot be refunded" leaves a customer
   * with nothing to do; "this claim was cancelled" tells them what to ask
   * support about.
   */
  it("names the status when the claim cannot be refunded", async () => {
    await VoucherClaim.updateOne(
      { _id: claim._id },
      { $set: { status: VOUCHER_CLAIM_STATUS.CANCELLED } },
    );

    await expect(ask()).rejects.toThrow(/cancelled and cannot be refunded/i);
  });

  it("refuses a payment that was never confirmed", async () => {
    await Transaction.updateOne({ _id: txn._id }, { $set: { verified: false } });
    await expect(ask()).rejects.toThrow(/no confirmed payment/i);
  });

  /**
   * ⚠️ In Phase 1 capture goes straight to REDEEMED, so every paid claim is
   * redeemed the moment it is paid. If REDEEMED were left off the refundable
   * list, nobody could ever ask for a refund at all.
   */
  it("still allows a redeemed claim, because every paid claim is one", async () => {
    expect(claim.status).toBe(VOUCHER_CLAIM_STATUS.REDEEMED);
    const result = await ask();
    expect(result.status).toBe(REFUND_REQUEST_STATUS.REQUESTED);
  });

  it("refuses more than was paid", async () => {
    await expect(ask({ amount: 8100 })).rejects.toThrow(/can still be refunded/i);
  });

  it("asks what went wrong when the reason is OTHER", async () => {
    await expect(ask({ reason: REFUND_REASON.OTHER })).rejects.toThrow(
      /tell us what went wrong/i,
    );

    const ok = await ask({
      reason: REFUND_REASON.OTHER,
      reasonNote: "The outlet was shut when I got there.",
    });
    expect(ok.status).toBe(REFUND_REQUEST_STATUS.REQUESTED);
  });
});

describe("the refund window", () => {
  /**
   * Measured from when the money was taken, not from when the claim was created
   * — a checkout abandoned for an hour and then paid would otherwise start its
   * window before the customer had paid anything.
   */
  it("refuses a claim paid outside the window", async () => {
    ({ transaction: txn, claim } = await seed({ paidAt: ago(72 * HOUR) }));

    await expect(ask()).rejects.toThrow(/within \d+ hours of payment/i);
  });

  it("allows one paid just inside it", async () => {
    ({ transaction: txn, claim } = await seed({ paidAt: ago(2 * HOUR) }));

    const result = await ask();
    expect(result.status).toBe(REFUND_REQUEST_STATUS.REQUESTED);
  });
});

describe("the claim's own story records it", () => {
  it("appends a REFUND_REQUESTED row", async () => {
    await ask();

    const rows = await VoucherClaimHistory.find({ claimId: claim._id }).lean();
    const requested = rows.find(
      (r) => r.action === CLAIM_HISTORY_ACTION.REFUND_REQUESTED,
    );

    expect(requested).toBeTruthy();
    expect(requested.amount).toBe(810);
    expect(requested.snapshot.split.vendorClawback).toBe(800);
  });

  /**
   * The audit write is failure-tolerant: losing a history row must never undo a
   * refund request the customer has already been told about.
   */
  it("still opens the request if the audit row cannot be written", async () => {
    const original = VoucherClaimHistory.create;
    VoucherClaimHistory.create = () => Promise.reject(new Error("disk on fire"));

    try {
      const result = await ask();
      expect(result.status).toBe(REFUND_REQUEST_STATUS.REQUESTED);
      // And the hold still landed — the part that protects the money.
      const after = await Transaction.findById(txn._id).lean();
      expect(after.settlementHold).toBe(true);
    } finally {
      VoucherClaimHistory.create = original;
    }
  });
});
