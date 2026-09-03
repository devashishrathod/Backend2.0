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
const RefundRequest = require("../../models/RefundRequest");
const LedgerEntry = require("../../models/LedgerEntry");
const PromoCodeUsage = require("../../models/PromoCodeUsage");
const PromoCode = require("../../models/PromoCode");
const Setting = require("../../models/Setting");
const { applyRefundCompletion } = require("../../helpers/refunds");
const { calculateRefundSplit } = require("../../helpers/refunds");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
  GATEWAY_FEE_BEARER,
} = require("../../constants/transaction");
const {
  VOUCHER_CLAIM_STATUS,
  CLAIM_HISTORY_ACTION,
} = require("../../constants/voucherClaim");
const {
  REFUND_REQUEST_STATUS,
  REFUND_REASON,
} = require("../../constants/refund");
const {
  LEDGER_ENTRY_TYPE,
  LEDGER_ACCOUNT,
  LEDGER_DIRECTION,
} = require("../../constants/ledger");
const { REFUND_STATUS, PAYMENT_STATUS } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();

let CUSTOMER;
let BRAND;
let claim;
let txn;

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
  vendorPayable: 800,
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
    gatewayFeeBearer: GATEWAY_FEE_BEARER.PLATFORM,
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
    pricing: PRICING,
    transactionId: txn._id,
    status: VOUCHER_CLAIM_STATUS.REDEEMED,
    claimCode: "TD-ACD349",
    holdsUsageSlot: true,
    isOncePerUser: true,
    voucherSnapshot: { name: "Test Voucher" },
  });

  await VoucherUsage.create({
    voucherClaimId: claimId,
    transactionId: txn._id,
    customerId: CUSTOMER,
    voucherId: claim.voucherId,
    voucherVersionId: claim.voucherVersionId,
    versionNumber: 1,
    brandId: BRAND,
    subBrandId: txn.subBrandId,
    billAmount: 1000,
    paidAmount: 810,
    isOncePerUser: true,
  });
};

/** A request already at PROCESSING, as the executor leaves it. */
const seedRequest = async ({ amount = 810, alreadyRefunded = 0 } = {}) => {
  const split = calculateRefundSplit({
    pricing: PRICING,
    paidAmount: 810,
    requestedAmount: amount,
    alreadyRefunded,
    gatewayFee: 17.94,
  });

  const doc = await RefundRequest.create({
    claimId: claim._id,
    transactionId: txn._id,
    customerId: CUSTOMER,
    brandId: BRAND,
    subBrandId: txn.subBrandId,
    claimCode: "TD-ACD349",
    requestedAmount: amount,
    approvedAmount: amount,
    split,
    reason: REFUND_REASON.NOT_HONOURED,
    razorpayRefundId: `rfnd_${Math.random().toString(36).slice(2, 12)}`,
  });

  doc.status = REFUND_REQUEST_STATUS.PROCESSING;
  await doc.save();
  return doc;
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
    PromoCodeUsage,
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
    PromoCodeUsage,
    PromoCode,
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
    PromoCodeUsage,
    PromoCode,
    Setting,
  );
  CUSTOMER = oid();
  BRAND = oid();
  await seed();
});

describe("a full refund lands", () => {
  it("marks the payment fully refunded", async () => {
    const request = await seedRequest();
    const result = await applyRefundCompletion({
      refundRequest: request,
      gatewayTotalRefunded: 810,
    });

    expect(result.applied).toBe(true);
    expect(result.isFullyRefunded).toBe(true);

    const after = await Transaction.findById(txn._id).lean();
    expect(after.amountRefunded).toBe(810);
    expect(after.refundStatus).toBe(REFUND_STATUS.COMPLETED);
    expect(after.isRefunded).toBe(true);
  });

  it("marks the claim refunded", async () => {
    const request = await seedRequest();
    await applyRefundCompletion({ refundRequest: request, gatewayTotalRefunded: 810 });

    const after = await VoucherClaim.findById(claim._id).lean();
    expect(after.status).toBe(VOUCHER_CLAIM_STATUS.REFUNDED);
    expect(after.refundAmount).toBe(810);
  });

  /**
   * ⚠️ The single most annoying way for this flow to be wrong.
   *
   * Without releasing the slot the customer is told *"you have already used this
   * offer"* for an offer they paid for and never got — and it is invisible from
   * our side.
   */
  it("gives the once-per-user slot back", async () => {
    const request = await seedRequest();
    await applyRefundCompletion({ refundRequest: request, gatewayTotalRefunded: 810 });

    const after = await VoucherClaim.findById(claim._id).lean();
    expect(after.holdsUsageSlot).toBe(false);

    const usage = await VoucherUsage.findOne({ voucherClaimId: claim._id }).lean();
    expect(usage.isReversed).toBe(true);
    expect(usage.reversedAt).toBeInstanceOf(Date);
  });

  /**
   * The hold stays on for the opposite reason it usually comes off: the money
   * is gone, so it was never the vendor's to be paid.
   */
  it("keeps the settlement hold on", async () => {
    const request = await seedRequest();
    await applyRefundCompletion({ refundRequest: request, gatewayTotalRefunded: 810 });

    const after = await Transaction.findById(txn._id).lean();
    expect(after.settlementHold).toBe(true);
  });

  it("writes a REFUNDED row to the claim's story", async () => {
    const request = await seedRequest();
    await applyRefundCompletion({
      refundRequest: request,
      gatewayTotalRefunded: 810,
      utr: "10000000000000",
    });

    const rows = await VoucherClaimHistory.find({ claimId: claim._id }).lean();
    const row = rows.find((r) => r.action === CLAIM_HISTORY_ACTION.REFUNDED);

    expect(row).toBeTruthy();
    expect(row.amount).toBe(810);
    expect(row.snapshot.utr).toBe("10000000000000");
    expect(row.toStatus).toBe(VOUCHER_CLAIM_STATUS.REFUNDED);
  });
});

describe("two partial refunds do not overwrite each other", () => {
  /**
   * ⚠️ The bug this milestone exists for.
   *
   * The old handler wrote `$set: { amountRefunded: thisRefundsAmount }`. A
   * payment refunded ₹300 then ₹200 reported ₹200, and the ₹310 still owed to
   * the vendor was invisible — settlement had no idea anything was outstanding.
   */
  it("accumulates rather than replaces", async () => {
    const first = await seedRequest({ amount: 300 });
    await applyRefundCompletion({ refundRequest: first, gatewayTotalRefunded: 300 });

    let after = await Transaction.findById(txn._id).lean();
    expect(after.amountRefunded).toBe(300);
    expect(after.refundStatus).toBe(REFUND_STATUS.PARTIAL);

    const second = await seedRequest({ amount: 200, alreadyRefunded: 300 });
    await applyRefundCompletion({ refundRequest: second, gatewayTotalRefunded: 500 });

    after = await Transaction.findById(txn._id).lean();
    // 300 + 200, not 200.
    expect(after.amountRefunded).toBe(500);
    expect(after.refundStatus).toBe(REFUND_STATUS.PARTIAL);
    expect(after.isRefunded).toBe(false);
  });

  /**
   * `$max`, so a late duplicate of an earlier smaller refund cannot walk the
   * total backwards. Razorpay does deliver out of order.
   */
  it("never lets the total go down", async () => {
    const first = await seedRequest({ amount: 300 });
    await applyRefundCompletion({ refundRequest: first, gatewayTotalRefunded: 500 });

    const second = await seedRequest({ amount: 200, alreadyRefunded: 500 });
    // A stale delivery reporting the older, smaller total.
    await applyRefundCompletion({ refundRequest: second, gatewayTotalRefunded: 300 });

    const after = await Transaction.findById(txn._id).lean();
    expect(after.amountRefunded).toBe(500);
  });

  /**
   * A partially refunded claim is still a claim that happened — the customer
   * ate, the outlet served them, and part of the money came back. Marking it
   * REFUNDED would erase a sale that mostly took place.
   */
  it("leaves the claim alone until the payment is fully back", async () => {
    const first = await seedRequest({ amount: 300 });
    await applyRefundCompletion({ refundRequest: first, gatewayTotalRefunded: 300 });

    const after = await VoucherClaim.findById(claim._id).lean();
    expect(after.status).toBe(VOUCHER_CLAIM_STATUS.REDEEMED);
    // And the slot stays held — they did get most of what they bought.
    expect(after.holdsUsageSlot).toBe(true);
  });

  it("finishes the job on the refund that completes the payment", async () => {
    const first = await seedRequest({ amount: 300 });
    await applyRefundCompletion({ refundRequest: first, gatewayTotalRefunded: 300 });

    const second = await seedRequest({ amount: 510, alreadyRefunded: 300 });
    const result = await applyRefundCompletion({
      refundRequest: second,
      gatewayTotalRefunded: 810,
    });

    expect(result.isFullyRefunded).toBe(true);
    const after = await VoucherClaim.findById(claim._id).lean();
    expect(after.status).toBe(VOUCHER_CLAIM_STATUS.REFUNDED);
    expect(after.holdsUsageSlot).toBe(false);
  });
});

describe("a redelivered webhook does nothing twice", () => {
  /**
   * Razorpay does resend `refund.processed`. The conditional claim on the
   * request's status is what makes the second delivery a no-op.
   */
  it("applies once and reports the second as already done", async () => {
    const request = await seedRequest();

    const first = await applyRefundCompletion({
      refundRequest: request,
      gatewayTotalRefunded: 810,
    });
    const second = await applyRefundCompletion({
      refundRequest: request,
      gatewayTotalRefunded: 810,
    });

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(second.reason).toBe("ALREADY_COMPLETED");
  });

  it("does not book the ledger rows a second time", async () => {
    const request = await seedRequest();
    await applyRefundCompletion({ refundRequest: request, gatewayTotalRefunded: 810 });

    const afterFirst = await LedgerEntry.countDocuments({
      refundRequestId: request._id,
    });

    await applyRefundCompletion({ refundRequest: request, gatewayTotalRefunded: 810 });

    const afterSecond = await LedgerEntry.countDocuments({
      refundRequestId: request._id,
    });
    expect(afterSecond).toBe(afterFirst);
  });

  /**
   * The index is the guarantee, not the conditional claim above it. Posting the
   * same set directly must still refuse.
   */
  it("refuses a duplicate row on the index itself", async () => {
    const { postRefundEntries } = require("../../helpers/ledger");
    const request = await seedRequest();

    const first = await postRefundEntries({
      transaction: txn,
      claim,
      split: request.split,
      refundRequest: request,
    });
    const second = await postRefundEntries({
      transaction: txn,
      claim,
      split: request.split,
      refundRequest: request,
    });

    expect(first.posted).toBeGreaterThan(0);
    expect(second.posted).toBe(0);
    expect(second.duplicates).toBe(first.posted);
  });
});

describe("the ledger mirrors the capture", () => {
  it("claws the vendor back and returns our fee", async () => {
    const request = await seedRequest();
    await applyRefundCompletion({ refundRequest: request, gatewayTotalRefunded: 810 });

    const rows = await LedgerEntry.find({ refundRequestId: request._id }).lean();
    const by = (type) => rows.find((r) => r.entryType === type);

    expect(by(LEDGER_ENTRY_TYPE.COLLECTION)).toMatchObject({
      account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
      direction: LEDGER_DIRECTION.DEBIT,
      amount: 800,
    });

    expect(by(LEDGER_ENTRY_TYPE.CONVENIENCE_FEE)).toMatchObject({
      account: LEDGER_ACCOUNT.PLATFORM_REVENUE,
      direction: LEDGER_DIRECTION.DEBIT,
      amount: 10,
    });
  });

  /**
   * ⚠️ Razorpay does not return its fee when a payment is refunded. Booked so
   * the loss appears in a report rather than quietly eroding margin.
   */
  it("books the gateway fee as a loss, not a reversal", async () => {
    const request = await seedRequest();
    await applyRefundCompletion({ refundRequest: request, gatewayTotalRefunded: 810 });

    const fee = await LedgerEntry.findOne({
      refundRequestId: request._id,
      entryType: LEDGER_ENTRY_TYPE.GATEWAY_FEE,
    }).lean();

    expect(fee).toMatchObject({
      account: LEDGER_ACCOUNT.PLATFORM_COST,
      direction: LEDGER_DIRECTION.DEBIT,
      amount: 17.94,
    });
  });

  it("dates the rows when the refund landed, not when the sale happened", async () => {
    const request = await seedRequest();
    await applyRefundCompletion({ refundRequest: request, gatewayTotalRefunded: 810 });

    const row = await LedgerEntry.findOne({
      refundRequestId: request._id,
    }).lean();

    // The capture rows belong to the cycle the sale happened in; these belong to
    // the cycle the money went back in.
    expect(row.occurredAt.getTime()).toBeGreaterThan(txn.createdAt.getTime() - 1000);
  });

  it("skips the rows that are worth nothing", async () => {
    const request = await seedRequest();
    await applyRefundCompletion({ refundRequest: request, gatewayTotalRefunded: 810 });

    const rows = await LedgerEntry.find({ refundRequestId: request._id }).lean();
    // No promo, no commission on this claim — three rows, not six of which
    // three say nothing.
    expect(rows.every((r) => r.amount > 0)).toBe(true);
    expect(rows).toHaveLength(3);
  });
});

describe("a refund that never went through us", () => {
  it("is refused rather than applied to the wrong request", async () => {
    const request = await seedRequest();
    await RefundRequest.updateOne(
      { _id: request._id },
      { $set: { status: REFUND_REQUEST_STATUS.VENDOR_REJECTED, isOpen: false } },
    );

    const result = await applyRefundCompletion({
      refundRequest: request,
      gatewayTotalRefunded: 810,
    });

    // A rejected request must not silently become a completed one.
    expect(result.applied).toBe(false);
  });
});

describe("the promo code, only when the setting says so", () => {
  const { PROMO_USAGE_STATUS } = require("../../constants/promoCode");

  const seedPromo = async () => {
    const promo = await PromoCode.create({
      code: `SAVE${Math.floor(Math.random() * 1e5)}`,
      discountType: "FLAT",
      discountValue: 35,
      usedCount: 1,
      isActive: true,
    });

    await PromoCodeUsage.create({
      promoCodeId: promo._id,
      code: promo.code,
      customerId: CUSTOMER,
      voucherClaimId: claim._id,
      transactionId: txn._id,
      // CONSUMED, as it is after a capture — which is why `releasePromoCode`
      // (RESERVED only) would find nothing here.
      status: PROMO_USAGE_STATUS.CONSUMED,
      discountAmount: 35,
      consumedAt: new Date(),
    });

    return promo;
  };

  const setRelease = (value) =>
    Setting.findOneAndUpdate(
      {},
      { $set: { "customer.refund.releasePromoOnRefund": value } },
      { upsert: true, returnDocument: "after" },
    );

  /**
   * The default, and the right one for a campaign budget: a customer who
   * claims, refunds, and claims again on the same code has spent our promo
   * money twice for one sale.
   */
  it("keeps the promo consumed by default", async () => {
    const promo = await seedPromo();
    const request = await seedRequest();

    await applyRefundCompletion({ refundRequest: request, gatewayTotalRefunded: 810 });

    const usage = await PromoCodeUsage.findOne({ transactionId: txn._id }).lean();
    expect(usage.status).toBe(PROMO_USAGE_STATUS.CONSUMED);
    expect((await PromoCode.findById(promo._id).lean()).usedCount).toBe(1);
  });

  it("gives it back when an admin turns the setting on", async () => {
    await setRelease(true);
    const promo = await seedPromo();
    const request = await seedRequest();

    await applyRefundCompletion({ refundRequest: request, gatewayTotalRefunded: 810 });

    const usage = await PromoCodeUsage.findOne({ transactionId: txn._id }).lean();
    expect(usage.status).toBe(PROMO_USAGE_STATUS.RELEASED);
    expect(usage.releaseReason).toMatch(/refunded/i);
    // And the code is usable again.
    expect((await PromoCode.findById(promo._id).lean()).usedCount).toBe(0);
  });

  /**
   * A partial refund leaves the customer holding part of what the promo
   * discounted, so the code was genuinely used.
   */
  it("never gives it back on a partial refund", async () => {
    await setRelease(true);
    await seedPromo();
    const request = await seedRequest({ amount: 300 });

    await applyRefundCompletion({ refundRequest: request, gatewayTotalRefunded: 300 });

    const usage = await PromoCodeUsage.findOne({ transactionId: txn._id }).lean();
    expect(usage.status).toBe(PROMO_USAGE_STATUS.CONSUMED);
  });

  /**
   * ⚠️ Without the `usedCount: { $gt: 0 }` guard a double release drives the
   * counter negative and hands out a single-use code twice.
   */
  it("cannot drive the used count below zero", async () => {
    await setRelease(true);
    const promo = await seedPromo();
    const request = await seedRequest();

    await applyRefundCompletion({ refundRequest: request, gatewayTotalRefunded: 810 });
    // A redelivered webhook: the conditional claim stops it, but the guard is
    // what would hold if it ever got through.
    await applyRefundCompletion({ refundRequest: request, gatewayTotalRefunded: 810 });

    expect((await PromoCode.findById(promo._id).lean()).usedCount).toBe(0);
  });

  it("does not fall over when the claim had no promo at all", async () => {
    await setRelease(true);
    const request = await seedRequest();

    const result = await applyRefundCompletion({
      refundRequest: request,
      gatewayTotalRefunded: 810,
    });
    expect(result.applied).toBe(true);
  });
});
