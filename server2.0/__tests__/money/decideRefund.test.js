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
const {
  approveRefundAsVendor,
  rejectRefundAsVendor,
  cancelRefund,
} = require("../../services/refunds");
const { releaseSettlementHold } = require("../../helpers/refunds");
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

let CUSTOMER;
let BRAND;
let OUTLET;
let claim;
let txn;
let request;

const vendor = (brandId = BRAND) => ({
  role: ROLES.VENDOR,
  brandId,
  userId: oid(),
});
const subVendor = (brandId = BRAND, subBrandId = OUTLET) => ({
  role: ROLES.SUB_VENDOR,
  brandId,
  subBrandId,
  userId: oid(),
});
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
  vendorPayable: 800,
};

const seed = async () => {
  const claimId = oid();

  txn = await Transaction.create({
    purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
    gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
    customerId: CUSTOMER,
    brandId: BRAND,
    subBrandId: OUTLET,
    amount: 810,
    paidAmount: 810,
    gatewayFee: 17.94,
    status: PAYMENT_STATUS.CAPTURED,
    verified: true,
    // The hold is already on — `requestRefund` puts it there.
    settlementHold: true,
    settlementHoldReason: "Refund requested",
    voucher: { claimId, billAmount: 1000, netBill: 800 },
  });

  claim = await VoucherClaim.create({
    _id: claimId,
    customerId: CUSTOMER,
    voucherId: oid(),
    voucherVersionId: oid(),
    versionNumber: 1,
    brandId: BRAND,
    subBrandId: OUTLET,
    billAmount: 1000,
    pricing: PRICING,
    transactionId: txn._id,
    status: VOUCHER_CLAIM_STATUS.REDEEMED,
    claimCode: "TD-ACD349",
    voucherSnapshot: { name: "Test Voucher" },
  });

  request = await RefundRequest.create({
    claimId,
    transactionId: txn._id,
    customerId: CUSTOMER,
    brandId: BRAND,
    subBrandId: OUTLET,
    claimCode: "TD-ACD349",
    requestedAmount: 810,
    reason: REFUND_REASON.NOT_HONOURED,
  });
};

const holdOn = async () =>
  (await Transaction.findById(txn._id).lean()).settlementHold;

beforeAll(async () => {
  await connectTestDb();
  for (const m of [Transaction, VoucherClaim, VoucherClaimHistory, RefundRequest]) {
    await m.createIndexes();
  }
});

afterAll(async () => {
  await clearCollections(Transaction, VoucherClaim, VoucherClaimHistory, RefundRequest);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(Transaction, VoucherClaim, VoucherClaimHistory, RefundRequest);
  CUSTOMER = oid();
  BRAND = oid();
  OUTLET = oid();
  await seed();
});

describe("the vendor approves", () => {
  it("approves the whole amount by default", async () => {
    const result = await approveRefundAsVendor(vendor(), request._id);

    expect(result.status).toBe(REFUND_REQUEST_STATUS.VENDOR_APPROVED);
    expect(result.approvedAmount).toBe(810);
    expect(result.isOpen).toBe(true);
  });

  /**
   * "Half the order was fine, the starter was not" is a real answer, and
   * lowering the amount is how a vendor gives it.
   */
  it("may approve for less", async () => {
    const result = await approveRefundAsVendor(vendor(), request._id, {
      approvedAmount: 400,
      note: "Only the starter was wrong.",
    });

    expect(result.approvedAmount).toBe(400);
    // What the customer asked for is not overwritten — the gap stays visible.
    expect(result.requestedAmount).toBe(810);
  });

  /**
   * ⚠️ Raising the amount is not an approval of what the customer asked for — it
   * is a new decision. A fat-fingered extra zero here would pay out ten times
   * the claim to somebody who never asked for it.
   */
  it("refuses to approve more than was asked for", async () => {
    await expect(
      approveRefundAsVendor(vendor(), request._id, { approvedAmount: 8100 }),
    ).rejects.toThrow(/asked for ₹810\.00. You can approve that or less/i);
  });

  /**
   * Frozen at **this** amount, not at the one requested. Everything downstream
   * reads this block and must describe the money that will actually move.
   */
  it("re-freezes the split at the approved amount", async () => {
    await approveRefundAsVendor(vendor(), request._id, { approvedAmount: 400 });
    const stored = await RefundRequest.findById(request._id).lean();

    expect(stored.split.totalRefund).toBe(400);
    expect(stored.split.vendorClawback).toBe(400);
    // A partial: our fee stays with us.
    expect(stored.split.convenienceFeeRefund).toBe(0);
    expect(stored.split.isFullRefund).toBe(false);
  });

  it("keeps the hold on — the money is still going back", async () => {
    await approveRefundAsVendor(vendor(), request._id);
    expect(await holdOn()).toBe(true);
  });

  it("appends a REFUND_APPROVED row to the claim's story", async () => {
    await approveRefundAsVendor(vendor(), request._id, { note: "Our mistake." });

    const rows = await VoucherClaimHistory.find({ claimId: claim._id }).lean();
    const row = rows.find((r) => r.action === CLAIM_HISTORY_ACTION.REFUND_APPROVED);

    expect(row).toBeTruthy();
    expect(row.amount).toBe(810);
  });
});

describe("the vendor declines", () => {
  it("requires a reason", async () => {
    await expect(rejectRefundAsVendor(vendor(), request._id)).rejects.toThrow(
      /say why you are declining/i,
    );
  });

  it("records the reason for whoever reviews it later", async () => {
    const result = await rejectRefundAsVendor(vendor(), request._id, {
      note: "Customer collected the order in full.",
    });

    expect(result.status).toBe(REFUND_REQUEST_STATUS.VENDOR_REJECTED);
    expect(result.vendorNote).toMatch(/collected the order/i);
    expect(result.isOpen).toBe(false);
  });

  /**
   * ⚠️ The failure this whole helper exists to prevent.
   *
   * A hold nobody releases keeps the vendor's money out of **every future
   * settlement**, for ever, and silently — the eligibility predicate just stops
   * matching. Nothing errors, nothing logs.
   */
  it("lets the vendor's money back into settlement", async () => {
    expect(await holdOn()).toBe(true);

    await rejectRefundAsVendor(vendor(), request._id, { note: "Not valid." });

    const after = await Transaction.findById(txn._id).lean();
    expect(after.settlementHold).toBe(false);
    // Kept, not cleared — "why was this payout late?" is the most common
    // question an admin has to answer.
    expect(after.settlementHoldReleasedAt).toBeInstanceOf(Date);
    expect(after.settlementHoldReleaseReason).toMatch(/declined/i);
  });
});

describe("the customer withdraws", () => {
  it("cancels their own request and frees the money", async () => {
    const result = await cancelRefund(customer(), request._id);

    expect(result.status).toBe(REFUND_REQUEST_STATUS.CANCELLED);
    expect(await holdOn()).toBe(false);
  });

  it("can still withdraw after the vendor has approved", async () => {
    await approveRefundAsVendor(vendor(), request._id);
    const result = await cancelRefund(customer(), request._id);

    expect(result.status).toBe(REFUND_REQUEST_STATUS.CANCELLED);
  });

  /**
   * Once it is PROCESSING the money is already with Razorpay and there is
   * nothing to withdraw. Saying so beats accepting a cancellation that will not
   * happen.
   */
  it("cannot withdraw once the money is on its way", async () => {
    await RefundRequest.updateOne(
      { _id: request._id },
      { $set: { status: REFUND_REQUEST_STATUS.PROCESSING } },
    );

    await expect(cancelRefund(customer(), request._id)).rejects.toThrow(
      /already processing and cannot be withdrawn/i,
    );
  });

  it("refuses another customer", async () => {
    await expect(cancelRefund(customer(oid()), request._id)).rejects.toThrow(
      /not authorized/i,
    );
  });
});

describe("two people cannot decide the same refund", () => {
  /**
   * An owner and an outlet manager can be looking at the same request. Without
   * the status in the update filter both clicks land, the second silently
   * overwrites the first, and the customer's answer depends on who was slower.
   */
  it("lets only one of two concurrent decisions land", async () => {
    const results = await Promise.allSettled([
      approveRefundAsVendor(vendor(), request._id),
      rejectRefundAsVendor(vendor(), request._id, { note: "No." }),
    ]);

    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");

    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0].reason.message).toMatch(/already been decided/i);
  });

  it("refuses a second decision on an already-decided request", async () => {
    await approveRefundAsVendor(vendor(), request._id);

    await expect(
      rejectRefundAsVendor(vendor(), request._id, { note: "Changed my mind." }),
    ).rejects.toThrow(/already been decided \(vendor approved\)/i);
  });

  /**
   * Once the window has run out the request belongs to an admin. Letting the
   * vendor reach back in would mean two people deciding the same thing.
   */
  it("says so when the clock has already run out", async () => {
    await RefundRequest.updateOne(
      { _id: request._id },
      { $set: { status: REFUND_REQUEST_STATUS.VENDOR_TIMEOUT } },
    );

    await expect(approveRefundAsVendor(vendor(), request._id)).rejects.toThrow(
      /already gone to Trydood for review/i,
    );
  });
});

describe("who may decide", () => {
  it("refuses another brand", async () => {
    await expect(
      approveRefundAsVendor(vendor(oid()), request._id),
    ).rejects.toThrow(/not authorized/i);
  });

  it("lets the outlet the claim was made at", async () => {
    const result = await approveRefundAsVendor(subVendor(), request._id);
    expect(result.status).toBe(REFUND_REQUEST_STATUS.VENDOR_APPROVED);
  });

  /**
   * `assertClaimAccess` applies the same rule to *reading* a claim; a decision
   * is the stronger action, so it cannot be looser.
   */
  it("refuses an outlet the claim was not made at", async () => {
    await expect(
      approveRefundAsVendor(subVendor(BRAND, oid()), request._id),
    ).rejects.toThrow(/different outlet/i);
  });

  it("refuses a customer trying to approve their own refund", async () => {
    await expect(
      approveRefundAsVendor(customer(), request._id),
    ).rejects.toThrow(/not authorized/i);
  });
});

describe("the hold is not released on someone else's behalf", () => {
  /**
   * ⚠️ A dispute hold lifted by refund logic would settle money that a bank is
   * in the middle of pulling back. Releasing it is an explicit admin action,
   * never a side effect.
   */
  it("leaves the hold on when a chargeback is open", async () => {
    await Transaction.updateOne(
      { _id: txn._id },
      { $set: { isDisputed: true, disputeResolvedAt: null } },
    );

    const result = await releaseSettlementHold({
      transactionId: txn._id,
      exceptRequestId: request._id,
      reason: "test",
    });

    expect(result).toEqual({ released: false, blockedBy: "DISPUTE" });
    expect(await holdOn()).toBe(true);
  });

  it("leaves it on while another refund is still open on the same payment", async () => {
    // Close the first so a second can exist, then reopen the question.
    await RefundRequest.updateOne(
      { _id: request._id },
      { $set: { status: REFUND_REQUEST_STATUS.CANCELLED, isOpen: false } },
    );
    const other = await RefundRequest.create({
      claimId: claim._id,
      transactionId: txn._id,
      customerId: CUSTOMER,
      brandId: BRAND,
      claimCode: "TD-ACD349",
      requestedAmount: 200,
      reason: REFUND_REASON.WRONG_AMOUNT,
    });

    const result = await releaseSettlementHold({
      transactionId: txn._id,
      exceptRequestId: request._id,
      reason: "test",
    });

    expect(result).toEqual({ released: false, blockedBy: "OTHER_REFUND" });
    expect(await holdOn()).toBe(true);
    expect(String(other.transactionId)).toBe(String(txn._id));
  });

  it("says nothing was held rather than pretending it released", async () => {
    await Transaction.updateOne(
      { _id: txn._id },
      { $set: { settlementHold: false } },
    );

    const result = await releaseSettlementHold({ transactionId: txn._id });
    expect(result).toEqual({ released: false, blockedBy: "NOT_HELD" });
  });

  /**
   * A dispute that has been resolved is no longer a reason to hold. Keying on
   * `disputeResolvedAt` rather than `isDisputed` matters because Razorpay's
   * dispute events are not monotonic — a late `lost` after a `won` would flip a
   * boolean back.
   */
  it("releases once the dispute is resolved", async () => {
    await Transaction.updateOne(
      { _id: txn._id },
      { $set: { isDisputed: true, disputeResolvedAt: new Date() } },
    );

    const result = await releaseSettlementHold({
      transactionId: txn._id,
      exceptRequestId: request._id,
      reason: "test",
    });

    expect(result.released).toBe(true);
  });
});
