const mongoose = require("mongoose");

const mockNotify = jest.fn(async () => ({ delivered: true }));
jest.mock("../../helpers/notifications/notify", () => ({
  notify: (...args) => mockNotify(...args),
  resolveRecipient: jest.fn(),
}));

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const RefundRequest = require("../../models/RefundRequest");
const VoucherClaim = require("../../models/VoucherClaim");
const VoucherUsage = require("../../models/VoucherUsage");
const VoucherClaimHistory = require("../../models/VoucherClaimHistory");
const Settlement = require("../../models/Settlement");
const SettlementHistory = require("../../models/SettlementHistory");
const LedgerEntry = require("../../models/LedgerEntry");
const Setting = require("../../models/Setting");
const { applyRefundCompletion } = require("../../helpers/refunds");
const { buildSettlements } = require("../../services/settlements");
const { SETTLEMENT_STATUS } = require("../../constants/settlement");
const {
  REFUND_REQUEST_STATUS,
  REFUND_REASON,
} = require("../../constants/refund");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");
const { PAYMENT_STATUS, REFUND_STATUS } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms);

let BRAND;
let seq = 0;

/**
 * A partial refund, all the way from the gateway to the vendor's payout.
 *
 * ### The bug this file exists for
 *
 * `buildEligibilityFilter` excluded on `amountRefunded: { $lte: 0 }` and
 * `applyRefundCompletion` left `settlementHold: true` on every completed refund.
 * Both are correct for a **full** refund and wrong for a partial one, and
 * `amountRefunded` only ever goes up — so a payment with ₹300 of ₹810 refunded
 * was removed from every future settlement, for ever, silently.
 *
 * `claimRefundAdjustments` then deducted that refund's clawback from a *later*
 * cycle regardless. The vendor was never paid the ₹500 they were owed **and**
 * was docked the clawback out of other sales: roughly ₹1,100 wrong on an ₹800
 * sale, with nothing anywhere raising.
 *
 * Two existing tests asserted the exclusion was correct. Their intent was right
 * — do not pay the vendor for the whole sale when part of it came back — but the
 * instrument was wrong. The netting belongs in the arithmetic, not in a filter.
 */

const CLAIM_ID = () => oid();

const payment = async (overrides = {}) => {
  const claimId = overrides.claimId || CLAIM_ID();
  const txn = await Transaction.create({
    purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
    gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
    customerId: oid(),
    brandId: BRAND,
    amount: 810,
    paidAmount: 810,
    status: PAYMENT_STATUS.CAPTURED,
    verified: true,
    verifiedAt: ago(5 * DAY),
    fundsReceivedAt: ago(4 * DAY),
    settlementHold: false,
    amountRefunded: 0,
    invoiceId: `TD/VCH/26-27/${Math.floor(Math.random() * 1e6)}`,
    voucher: {
      claimId,
      netBill: 800,
      vendorPayable: 800,
      vendorPromoCost: 50,
      commissionAmount: 0,
    },
    ...overrides,
  });
  return txn;
};

/**
 * The split is frozen on the request at approval, so the figures here are the
 * ones that actually move. `calculateRefundSplit` has its own suite; stating
 * `vendorClawback` explicitly keeps this file's arithmetic assertions readable.
 */
const refundRequest = (txn, { total, clawback, status } = {}) =>
  RefundRequest.create({
    claimId: txn.voucher.claimId,
    transactionId: txn._id,
    customerId: txn.customerId,
    brandId: BRAND,
    claimCode: `TD-P${String(++seq).padStart(5, "0")}`,
    requestedAmount: total,
    approvedAmount: total,
    reason: REFUND_REASON.OTHER,
    status: status || REFUND_REQUEST_STATUS.PROCESSING,
    split: { totalRefund: total, vendorClawback: clawback },
  });

const settlementOf = () =>
  Settlement.findOne({ brandId: BRAND, isDeleted: false })
    .sort({ createdAt: -1 })
    .lean();

const reread = (txn) => Transaction.findById(txn._id).lean();

beforeAll(async () => {
  await connectTestDb();
  for (const m of [Transaction, RefundRequest, Settlement, LedgerEntry]) {
    await m.createIndexes();
  }
});

afterAll(async () => {
  await clearCollections(
    Transaction,
    RefundRequest,
    VoucherClaim,
    VoucherUsage,
    VoucherClaimHistory,
    Settlement,
    SettlementHistory,
    LedgerEntry,
    Setting,
  );
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(
    Transaction,
    RefundRequest,
    VoucherClaim,
    VoucherUsage,
    VoucherClaimHistory,
    Settlement,
    SettlementHistory,
    LedgerEntry,
    Setting,
  );
  BRAND = oid();
  mockNotify.mockClear();
});

describe("what a completed refund does to the payment", () => {
  it("marks a partial refund PARTIAL and lets the money move again", async () => {
    const txn = await payment();
    const request = await refundRequest(txn, { total: 300, clawback: 296.3 });

    await applyRefundCompletion({
      refundRequest: request,
      gatewayTotalRefunded: 300,
    });

    const after = await reread(txn);
    expect(after.amountRefunded).toBe(300);
    expect(after.isRefunded).toBe(false);
    expect(after.refundStatus).toBe(REFUND_STATUS.PARTIAL);
    // ⚠️ The line that used to strand the vendor's remaining ₹500 for ever.
    expect(after.settlementHold).toBe(false);
  });

  it("keeps a full refund held — it was never the vendor's", async () => {
    const txn = await payment();
    const request = await refundRequest(txn, { total: 810, clawback: 800 });

    await applyRefundCompletion({
      refundRequest: request,
      gatewayTotalRefunded: 810,
    });

    const after = await reread(txn);
    expect(after.isRefunded).toBe(true);
    expect(after.refundStatus).toBe(REFUND_STATUS.COMPLETED);
    expect(after.settlementHold).toBe(true);
  });

  /**
   * ⚠️ `amountRefunded` was `$max`-protected while the flags beside it were a
   * plain `$set`, so a late, smaller delivery walked a fully refunded payment
   * back to `PARTIAL` — and with the eligibility change, back into a payout run.
   * Both now derive from the stored total in one pipeline update.
   */
  it("cannot be walked backwards by an out-of-order delivery", async () => {
    const txn = await payment();

    const big = await refundRequest(txn, { total: 810, clawback: 800 });
    await applyRefundCompletion({
      refundRequest: big,
      gatewayTotalRefunded: 810,
    });

    // A stale duplicate of an earlier, smaller refund arrives afterwards.
    const small = await refundRequest(txn, { total: 300, clawback: 296.3 });
    await applyRefundCompletion({
      refundRequest: small,
      gatewayTotalRefunded: 300,
    });

    const after = await reread(txn);
    expect(after.amountRefunded).toBe(810);
    expect(after.isRefunded).toBe(true);
    expect(after.refundStatus).toBe(REFUND_STATUS.COMPLETED);
    expect(after.settlementHold).toBe(true);
  });

  /** Two partials that together add up to the whole thing close it properly. */
  it("closes the payment when partials add up to the full amount", async () => {
    const txn = await payment();

    const first = await refundRequest(txn, { total: 300, clawback: 296.3 });
    await applyRefundCompletion({
      refundRequest: first,
      gatewayTotalRefunded: 300,
    });
    expect((await reread(txn)).settlementHold).toBe(false);

    const second = await refundRequest(txn, { total: 510, clawback: 503.7 });
    await applyRefundCompletion({
      refundRequest: second,
      gatewayTotalRefunded: 810,
    });

    const after = await reread(txn);
    expect(after.isRefunded).toBe(true);
    expect(after.settlementHold).toBe(true);
  });

  /**
   * The release asks, it does not overrule. A chargeback on the same payment
   * outranks a partial refund's release.
   */
  it("does not release a hold a chargeback is also holding", async () => {
    const txn = await payment({ isDisputed: true, disputeResolvedAt: null });
    const request = await refundRequest(txn, { total: 300, clawback: 296.3 });

    await applyRefundCompletion({
      refundRequest: request,
      gatewayTotalRefunded: 300,
    });

    expect((await reread(txn)).settlementHold).toBe(true);
  });

  /**
   * ⚠️ "Two open refunds on one payment" cannot happen, and that matters here.
   *
   * `releaseSettlementHold` refuses on `OTHER_REFUND`, so the obvious worry
   * about the release above is a second open request. `refund_open_per_transaction_unique`
   * makes that state unreachable: the database refuses the second one.
   *
   * Written as the index assertion rather than as a behaviour test, because a
   * behaviour test for an unreachable state passes for the wrong reason. The
   * `OTHER_REFUND` branch itself is covered in `decideRefund.test.js`, against
   * the narrow race where a request is raised in the moment between one closing
   * and its hold being released.
   */
  it("cannot have a second open refund racing the release", async () => {
    const txn = await payment();
    await refundRequest(txn, {
      total: 100,
      clawback: 98,
      status: REFUND_REQUEST_STATUS.REQUESTED,
    });

    await expect(
      refundRequest(txn, { total: 300, clawback: 296.3 }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});

describe("the vendor actually gets the remainder", () => {
  /**
   * The arithmetic that was wrong. `grossCollected − vendorPromoCost −
   * commission − refundAdjustment`, with the payment claimed at full value and
   * its refund claimed beside it.
   */
  it("pays the sale net of the clawback, in one cycle", async () => {
    const txn = await payment();
    const request = await refundRequest(txn, { total: 300, clawback: 296.3 });
    await applyRefundCompletion({
      refundRequest: request,
      gatewayTotalRefunded: 300,
    });

    const result = await buildSettlements();
    expect(result.built).toBe(1);

    const s = await settlementOf();
    expect(s.grossCollected).toBe(800);
    expect(s.vendorPromoCost).toBe(50);
    expect(s.refundAdjustment).toBe(296.3);
    // 800 − 50 − 0 − 296.30
    expect(s.netPayable).toBe(453.7);
  });

  /**
   * ⚠️ The double deduction. A fully refunded payment is excluded from
   * eligibility for ever, so its clawback must **not** be taken out of the
   * vendor's other sales — they were never paid for it in the first place.
   */
  it("does not claw back a refund on a payment that was never settled", async () => {
    const good = await payment();
    const refunded = await payment();
    const request = await refundRequest(refunded, {
      total: 810,
      clawback: 800,
    });
    await applyRefundCompletion({
      refundRequest: request,
      gatewayTotalRefunded: 810,
    });

    await buildSettlements();

    const s = await settlementOf();
    expect(s.transactionCount).toBe(1);
    expect(s.refundAdjustment).toBe(0);
    // The untouched sale is paid in full: 800 − 50.
    expect(s.netPayable).toBe(750);
    expect(String(good.brandId)).toBe(String(BRAND));
  });

  /**
   * The carry-back case this machinery was written for, and it still works: a
   * refund on a payment that was already paid out is deducted from a later
   * cycle.
   */
  it("still claws back a refund on a payment that was already paid out", async () => {
    const old = await payment();
    await buildSettlements();

    const first = await settlementOf();
    expect(first.netPayable).toBe(750);
    await Settlement.updateOne(
      { _id: first._id },
      { $set: { status: SETTLEMENT_STATUS.PAID } },
    );

    // Refunded after the vendor already had the money.
    const request = await refundRequest(old, { total: 300, clawback: 296.3 });
    await applyRefundCompletion({
      refundRequest: request,
      gatewayTotalRefunded: 300,
    });

    // A fresh sale in the next cycle, which the clawback comes out of.
    await payment();
    await Settlement.updateOne(
      { _id: first._id },
      { $set: { idempotencyKey: `STL:VOID:${first._id}` } },
    );
    await buildSettlements();

    const second = await settlementOf();
    expect(String(second._id)).not.toBe(String(first._id));
    expect(second.refundAdjustment).toBe(296.3);
  });

  /**
   * A refund bigger than the remaining takings drives the cycle negative, which
   * `CARRIED_FORWARD` is for — never a payout of a negative amount.
   */
  it("carries the cycle forward when the clawback exceeds the takings", async () => {
    const txn = await payment();
    const request = await refundRequest(txn, { total: 800, clawback: 790 });
    await applyRefundCompletion({
      refundRequest: request,
      gatewayTotalRefunded: 800,
    });

    await buildSettlements();

    const s = await settlementOf();
    expect(s.netPayable).toBeLessThanOrEqual(0);
    expect(s.status).toBe(SETTLEMENT_STATUS.CARRIED_FORWARD);
  });

  /**
   * ⚠️ The claim order is load-bearing. `claimRefundAdjustments` keys on the
   * payment already carrying a `settlementId`, which `claimTransactions` stamps
   * — so if the two ran concurrently the deduction could be skipped and the
   * vendor paid the full sale.
   */
  it("claims the refund in the same cycle as the payment it belongs to", async () => {
    const txn = await payment();
    const request = await refundRequest(txn, { total: 300, clawback: 296.3 });
    await applyRefundCompletion({
      refundRequest: request,
      gatewayTotalRefunded: 300,
    });

    await buildSettlements();
    const s = await settlementOf();

    const claimedRefund = await RefundRequest.findById(request._id).lean();
    const claimedTxn = await reread(txn);

    expect(String(claimedRefund.settlementId)).toBe(String(s._id));
    expect(String(claimedTxn.settlementId)).toBe(String(s._id));
  });

  /** Whatever else changes, the vendor is never worse off than the clawback. */
  it("never docks the vendor more than the refund took", async () => {
    const txn = await payment();
    const request = await refundRequest(txn, { total: 300, clawback: 296.3 });
    await applyRefundCompletion({
      refundRequest: request,
      gatewayTotalRefunded: 300,
    });

    await buildSettlements();
    const s = await settlementOf();

    const withoutRefund = 800 - 50;
    expect(withoutRefund - s.netPayable).toBeCloseTo(296.3, 2);
  });
});
