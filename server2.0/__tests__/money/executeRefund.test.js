const mongoose = require("mongoose");

/**
 * Razorpay is mocked here, and only Razorpay.
 *
 * ⚠️ The factory may not close over anything out of scope unless it is named
 * `mock*` — jest hoists it above the imports.
 */
const mockRefund = jest.fn();
const mockFetchMultipleRefund = jest.fn();

jest.mock("../../configs/razorpay", () => ({
  getRazorpayAccount: () => ({
    keyId: "rzp_test_x",
    instance: {
      payments: {
        refund: (...args) => mockRefund(...args),
        fetchMultipleRefund: (...args) => mockFetchMultipleRefund(...args),
      },
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
const RefundRequest = require("../../models/RefundRequest");
const {
  approveRefundAsAdmin,
  rejectRefundAsAdmin,
  executeRefund,
} = require("../../services/refunds");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");
const { VOUCHER_CLAIM_STATUS, CLAIM_HISTORY_ACTION } = require("../../constants/voucherClaim");
const {
  REFUND_REQUEST_STATUS,
  REFUND_REASON,
} = require("../../constants/refund");
const { REFUND_METHODS } = require("../../constants/customer");
const { ROLES, PAYMENT_STATUS } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();

let CUSTOMER;
let BRAND;
let claim;
let txn;
let request;

const admin = () => ({ role: ROLES.ADMIN, userId: oid() });
const vendor = () => ({ role: ROLES.VENDOR, brandId: BRAND, userId: oid() });

const seed = async (status = REFUND_REQUEST_STATUS.VENDOR_APPROVED) => {
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
    voucherSnapshot: { name: "Test Voucher" },
  });

  const doc = await RefundRequest.create({
    claimId,
    transactionId: txn._id,
    customerId: CUSTOMER,
    brandId: BRAND,
    subBrandId: txn.subBrandId,
    claimCode: "TD-ACD349",
    requestedAmount: 810,
    approvedAmount: 810,
    method: REFUND_METHODS.SOURCE,
    reason: REFUND_REASON.NOT_HONOURED,
  });

  if (status !== REFUND_REQUEST_STATUS.REQUESTED) {
    doc.status = status;
    await doc.save();
  }
  request = doc;
};

const razorpayRefund = (overrides = {}) => ({
  id: "rfnd_MK1z9UcQ2Xa3bC",
  amount: 81000,
  speed_processed: "normal",
  acquirer_data: { arn: "10000000000000" },
  notes: { refundRequestId: String(request._id) },
  ...overrides,
});

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
  mockRefund.mockReset();
  mockFetchMultipleRefund.mockReset();
  CUSTOMER = oid();
  BRAND = oid();
  await seed();
});

describe("the admin clears it for payment", () => {
  it("approves what the vendor already approved, with no reason needed", async () => {
    const result = await approveRefundAsAdmin(admin(), request._id);

    expect(result.status).toBe(REFUND_REQUEST_STATUS.ADMIN_APPROVED);
    expect(result.isOverride).toBeFalsy();
  });

  /**
   * A rising override rate does not mean admins are being generous — it means
   * something upstream is wrong. It is only countable if it is recorded
   * separately from an ordinary approval.
   */
  it("needs a written reason to override the outlet's no", async () => {
    await RefundRequest.updateOne(
      { _id: request._id },
      { $set: { status: REFUND_REQUEST_STATUS.VENDOR_REJECTED, isOpen: false } },
    );

    await expect(approveRefundAsAdmin(admin(), request._id)).rejects.toThrow(
      /outlet declined this refund. Say why you are overriding/i,
    );

    const ok = await approveRefundAsAdmin(admin(), request._id, {
      overrideReason: "Outlet was shut; photos confirm it.",
    });
    expect(ok.status).toBe(REFUND_REQUEST_STATUS.ADMIN_OVERRIDE);
    expect(ok.isOverride).toBe(true);
  });

  it("asks a different question when the outlet simply went silent", async () => {
    await RefundRequest.updateOne(
      { _id: request._id },
      { $set: { status: REFUND_REQUEST_STATUS.VENDOR_TIMEOUT } },
    );

    await expect(approveRefundAsAdmin(admin(), request._id)).rejects.toThrow(
      /did not respond. Say why you are approving this yourself/i,
    );
  });

  it("releases the hold when the admin declines", async () => {
    await rejectRefundAsAdmin(admin(), request._id, { note: "Not supported by evidence." });

    const after = await Transaction.findById(txn._id).lean();
    expect(after.settlementHold).toBe(false);
    expect(after.settlementHoldReleaseReason).toMatch(/after review/i);
  });

  it("refuses anyone who is not an admin", async () => {
    await expect(approveRefundAsAdmin(vendor(), request._id)).rejects.toThrow(
      /only an admin/i,
    );
    await expect(executeRefund(vendor(), request._id)).rejects.toThrow(/only an admin/i);
  });
});

describe("sending the money", () => {
  beforeEach(async () => {
    await approveRefundAsAdmin(admin(), request._id);
  });

  it("calls Razorpay with the payment id and the approved amount in paise", async () => {
    mockRefund.mockResolvedValue(razorpayRefund());

    const result = await executeRefund(admin(), request._id);

    expect(mockRefund).toHaveBeenCalledTimes(1);
    const [paymentId, params] = mockRefund.mock.calls[0];
    expect(paymentId).toBe("pay_MK1z9UcQ2Xa3bC");
    expect(params.amount).toBe(81000);
    // Stamped so a recovery lookup can tell our refund from one somebody issued
    // by hand in the dashboard.
    expect(params.notes.refundRequestId).toBe(String(request._id));

    expect(result.status).toBe(REFUND_REQUEST_STATUS.PROCESSING);
    expect(result.razorpayRefundId).toBe("rfnd_MK1z9UcQ2Xa3bC");
  });

  /**
   * The customer quotes the UTR to their bank, so it is the one field support
   * actually needs.
   */
  it("stores the bank reference Razorpay hands back", async () => {
    mockRefund.mockResolvedValue(razorpayRefund());
    const result = await executeRefund(admin(), request._id);

    expect(result.utr).toBe("10000000000000");
  });

  it("pays the approved amount, not the requested one", async () => {
    await RefundRequest.updateOne({ _id: request._id }, { $set: { approvedAmount: 400 } });
    mockRefund.mockResolvedValue(razorpayRefund({ amount: 40000 }));

    await executeRefund(admin(), request._id);
    expect(mockRefund.mock.calls[0][1].amount).toBe(40000);
  });

  it("keeps the settlement hold on while the money is in flight", async () => {
    mockRefund.mockResolvedValue(razorpayRefund());
    await executeRefund(admin(), request._id);

    const after = await Transaction.findById(txn._id).lean();
    expect(after.settlementHold).toBe(true);
  });
});

describe("a crash must never send the money twice", () => {
  /**
   * ⚠️ The reason `attemptCount` is bumped **before** the gateway call.
   *
   * If the process dies between Razorpay accepting the refund and the id being
   * stored, the row says PROCESSING with no `razorpayRefundId`. Incrementing
   * after the call would leave the counter at zero, and the retry would send the
   * customer their money a second time.
   */
  it("adopts a refund an earlier attempt already made", async () => {
    await approveRefundAsAdmin(admin(), request._id);

    // The first attempt: Razorpay accepted, then the process died.
    mockRefund.mockResolvedValue(razorpayRefund());
    mockRefund.mockImplementationOnce(async () => {
      throw Object.assign(new Error("socket hang up"), { crashed: true });
    });
    await expect(executeRefund(admin(), request._id)).rejects.toThrow(/socket hang up/i);

    // Razorpay does have it, stamped with our request id.
    mockFetchMultipleRefund.mockResolvedValue({ items: [razorpayRefund()] });
    mockRefund.mockClear();

    const result = await executeRefund(admin(), request._id);

    expect(mockFetchMultipleRefund).toHaveBeenCalledWith("pay_MK1z9UcQ2Xa3bC");
    // Nothing new was sent.
    expect(mockRefund).not.toHaveBeenCalled();
    expect(result.recovered).toBe(true);
    expect(result.razorpayRefundId).toBe("rfnd_MK1z9UcQ2Xa3bC");
  });

  it("does not adopt somebody else's refund on the same payment", async () => {
    await approveRefundAsAdmin(admin(), request._id);

    mockRefund.mockImplementationOnce(async () => {
      throw new Error("socket hang up");
    });
    await expect(executeRefund(admin(), request._id)).rejects.toThrow();

    // A refund issued by hand in the dashboard, with no note of ours.
    mockFetchMultipleRefund.mockResolvedValue({
      items: [{ id: "rfnd_someoneelse", amount: 81000, notes: {} }],
    });
    mockRefund.mockResolvedValue(razorpayRefund());
    // Cleared, so the deliberately-failed first attempt is not counted here.
    mockRefund.mockClear();

    const result = await executeRefund(admin(), request._id);

    // Ours was genuinely never sent, so it is sent now.
    expect(mockRefund).toHaveBeenCalledTimes(1);
    expect(result.razorpayRefundId).toBe("rfnd_MK1z9UcQ2Xa3bC");
  });

  /**
   * A lookup failure must not become a second refund. Leaving the row
   * PROCESSING for a human is the safe way to be wrong.
   */
  it("refuses to guess when it cannot reach Razorpay to check", async () => {
    await approveRefundAsAdmin(admin(), request._id);

    mockRefund.mockImplementationOnce(async () => {
      throw new Error("socket hang up");
    });
    await expect(executeRefund(admin(), request._id)).rejects.toThrow();

    mockFetchMultipleRefund.mockRejectedValue(new Error("gateway down"));
    mockRefund.mockClear();

    await expect(executeRefund(admin(), request._id)).rejects.toThrow(
      /could not check razorpay/i,
    );
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it("counts every attempt, so the check is never skipped", async () => {
    await approveRefundAsAdmin(admin(), request._id);
    mockRefund.mockImplementationOnce(async () => {
      throw new Error("declined");
    });

    await expect(executeRefund(admin(), request._id)).rejects.toThrow();

    const after = await RefundRequest.findById(request._id).lean();
    expect(after.attemptCount).toBe(1);
    expect(after.status).toBe(REFUND_REQUEST_STATUS.FAILED);
  });
});

describe("when Razorpay says no", () => {
  beforeEach(async () => {
    await approveRefundAsAdmin(admin(), request._id);
  });

  it("records why, and leaves the refund open", async () => {
    mockRefund.mockRejectedValue({
      error: { description: "The payment has been fully refunded already" },
    });

    await expect(executeRefund(admin(), request._id)).rejects.toThrow(
      /fully refunded already/i,
    );

    const after = await RefundRequest.findById(request._id).lean();
    expect(after.status).toBe(REFUND_REQUEST_STATUS.FAILED);
    expect(after.failureReason).toMatch(/fully refunded/i);
    // Still open — the money has not gone back, and this is what an admin
    // retries from.
    expect(after.isOpen).toBe(true);
  });

  /**
   * The hold stays on after a failure for the same reason the request stays
   * open: the money is still owed to the customer.
   */
  it("keeps the settlement hold on after a failure", async () => {
    mockRefund.mockRejectedValue(new Error("bank unreachable"));
    await expect(executeRefund(admin(), request._id)).rejects.toThrow();

    const after = await Transaction.findById(txn._id).lean();
    expect(after.settlementHold).toBe(true);
  });

  it("writes a REFUND_FAILED row to the claim's story", async () => {
    mockRefund.mockRejectedValue(new Error("bank unreachable"));
    await expect(executeRefund(admin(), request._id)).rejects.toThrow();

    const rows = await VoucherClaimHistory.find({ claimId: claim._id }).lean();
    expect(
      rows.some((r) => r.action === CLAIM_HISTORY_ACTION.REFUND_FAILED),
    ).toBe(true);
  });

  it("can be retried after a failure", async () => {
    mockRefund.mockRejectedValueOnce(new Error("bank unreachable"));
    await expect(executeRefund(admin(), request._id)).rejects.toThrow();

    mockFetchMultipleRefund.mockResolvedValue({ items: [] });
    mockRefund.mockResolvedValue(razorpayRefund());

    const result = await executeRefund(admin(), request._id);
    expect(result.status).toBe(REFUND_REQUEST_STATUS.PROCESSING);
  });
});

describe("what it will not pay", () => {
  it("refuses a refund the vendor has not decided on", async () => {
    await RefundRequest.updateOne(
      { _id: request._id },
      { $set: { status: REFUND_REQUEST_STATUS.REQUESTED } },
    );

    await expect(executeRefund(admin(), request._id)).rejects.toThrow(
      /requested and cannot be paid yet/i,
    );
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it("refuses one already completed", async () => {
    await RefundRequest.updateOne(
      { _id: request._id },
      { $set: { status: REFUND_REQUEST_STATUS.COMPLETED, isOpen: false } },
    );

    await expect(executeRefund(admin(), request._id)).rejects.toThrow(
      /completed and cannot be paid/i,
    );
  });

  it("refuses a bank transfer, which is not automated", async () => {
    await approveRefundAsAdmin(admin(), request._id);
    await RefundRequest.updateOne(
      { _id: request._id },
      { $set: { method: REFUND_METHODS.MANUAL_BANK } },
    );

    await expect(executeRefund(admin(), request._id)).rejects.toThrow(
      /bank account, which is not automated/i,
    );
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it("refuses a payment with no Razorpay id behind it", async () => {
    await approveRefundAsAdmin(admin(), request._id);
    await Transaction.updateOne(
      { _id: txn._id },
      { $unset: { razorpayPaymentId: "" } },
    );

    await expect(executeRefund(admin(), request._id)).rejects.toThrow(
      /no Razorpay id to refund against/i,
    );
  });
});
