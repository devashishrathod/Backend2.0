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
const { getRefunds, getRefundDetail } = require("../../services/refunds");
const { refundProjection } = require("../../helpers/refunds");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");
const { VOUCHER_CLAIM_STATUS } = require("../../constants/voucherClaim");
const {
  REFUND_REQUEST_STATUS,
  REFUND_REASON,
  REFUND_CUSTOMER_LABEL,
} = require("../../constants/refund");
const { ROLES, PAYMENT_STATUS } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();
const HOUR = 60 * 60 * 1000;

let CUSTOMER_A;
let CUSTOMER_B;
let BRAND_A;
let BRAND_B;
let OUTLET_1;
let OUTLET_2;

const customer = (id) => ({ role: ROLES.CUSTOMER, customerId: id });
const vendor = (brandId) => ({ role: ROLES.VENDOR, brandId });
const subVendor = (brandId, subBrandId) => ({
  role: ROLES.SUB_VENDOR,
  brandId,
  subBrandId,
});
const admin = () => ({ role: ROLES.ADMIN });

/** The full split, so the fields a vendor must not see are actually present. */
const SPLIT = {
  totalRefund: 810,
  netBillRefund: 800,
  convenienceFeeRefund: 10,
  taxRefund: 0,
  vendorClawback: 800,
  platformPromoReversal: 35,
  vendorPromoReversal: 20,
  commissionReversal: 24,
  gatewayFeeAbsorbed: 17.94,
  isFullRefund: true,
};

const seed = async ({
  customerId,
  brandId,
  subBrandId,
  status = REFUND_REQUEST_STATUS.REQUESTED,
  createdAt,
} = {}) => {
  const claimId = oid();

  const txn = await Transaction.create({
    purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
    gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
    customerId,
    brandId,
    subBrandId,
    amount: 810,
    paidAmount: 810,
    status: PAYMENT_STATUS.CAPTURED,
    verified: true,
    voucher: { claimId, billAmount: 1000, netBill: 800 },
  });

  await VoucherClaim.create({
    _id: claimId,
    customerId,
    voucherId: oid(),
    voucherVersionId: oid(),
    versionNumber: 1,
    brandId,
    subBrandId,
    billAmount: 1000,
    pricing: { netBill: 800, convenienceFee: 10, platformPromoCost: 35 },
    transactionId: txn._id,
    status: VOUCHER_CLAIM_STATUS.REDEEMED,
    claimCode: `TD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    voucherSnapshot: { name: "Test Voucher" },
  });

  const doc = await RefundRequest.create({
    claimId,
    transactionId: txn._id,
    customerId,
    brandId,
    subBrandId,
    claimCode: `TD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    requestedAmount: 810,
    approvedAmount: 810,
    split: SPLIT,
    reason: REFUND_REASON.NOT_HONOURED,
    reasonNote: "The outlet was shut.",
    vendorNote: "Customer collected the order in full.",
    adminNote: "Overrode the outlet; photos support the customer.",
    overrideReason: "Photos support the customer.",
    utr: "10000000000000",
    razorpayRefundId: `rfnd_${Math.random().toString(36).slice(2, 12)}`,
    vendorRespondBy: new Date(Date.now() + 24 * HOUR),
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
  CUSTOMER_A = oid();
  CUSTOMER_B = oid();
  BRAND_A = oid();
  BRAND_B = oid();
  OUTLET_1 = oid();
  OUTLET_2 = oid();

  await seed({ customerId: CUSTOMER_A, brandId: BRAND_A, subBrandId: OUTLET_1 });
  await seed({ customerId: CUSTOMER_A, brandId: BRAND_B, subBrandId: oid() });
  await seed({ customerId: CUSTOMER_B, brandId: BRAND_A, subBrandId: OUTLET_2 });
});

describe("one endpoint, three shapes", () => {
  it("shows a customer only their own", async () => {
    const { data } = await getRefunds(customer(CUSTOMER_A));
    expect(data).toHaveLength(2);
  });

  it("shows a vendor only their brand's", async () => {
    const { data } = await getRefunds(vendor(BRAND_A));
    expect(data).toHaveLength(2);
  });

  it("scopes a sub-vendor to their counter", async () => {
    const { data } = await getRefunds(subVendor(BRAND_A, OUTLET_2));
    expect(data).toHaveLength(1);
  });

  it("shows an admin everything", async () => {
    const { data } = await getRefunds(admin());
    expect(data).toHaveLength(3);
  });

  it("is an empty list, not a 404, for someone who never asked", async () => {
    const { data, total } = await getRefunds(customer(oid()));
    expect(data).toEqual([]);
    expect(total).toBe(0);
  });
});

describe("what a vendor must never read", () => {
  /**
   * ⚠️ `split` carries `platformPromoReversal` and `gatewayFeeAbsorbed` — our
   * promo share and the MDR we swallow — on the **same sub-document** as
   * `vendorClawback`, which the vendor genuinely needs. That is exactly why the
   * decision is made in one place rather than remembered at each call site.
   */
  it("hides our promo share and the MDR", async () => {
    const { data } = await getRefunds(vendor(BRAND_A));
    const row = data[0];

    expect(row.split.vendorClawback).toBe(800);
    expect(row.split.platformPromoReversal).toBeUndefined();
    expect(row.split.gatewayFeeAbsorbed).toBeUndefined();
    expect(row.split.commissionReversal).toBeUndefined();
  });

  it("hides the customer's identity", async () => {
    const { data } = await getRefunds(vendor(BRAND_A));
    expect(data[0].customerId).toBeUndefined();
  });

  /**
   * The admin's note is staff-to-staff, and an override reason names a decision
   * taken against the vendor. Neither is theirs to read.
   */
  it("hides the admin's notes", async () => {
    const { data } = await getRefunds(vendor(BRAND_A));
    expect(data[0].adminNote).toBeUndefined();
    expect(data[0].overrideReason).toBeUndefined();
  });

  it("shows them their own note and why the customer complained", async () => {
    const { data } = await getRefunds(vendor(BRAND_A));
    expect(data[0].vendorNote).toMatch(/collected the order/i);
    expect(data[0].reasonNote).toMatch(/outlet was shut/i);
  });
});

describe("what a customer reads", () => {
  it("gets the amount and the bank reference, not the breakdown", async () => {
    const { data } = await getRefunds(customer(CUSTOMER_A));
    const row = data[0];

    expect(row.split.totalRefund).toBe(810);
    // The one field support is actually asked for.
    expect(row.utr).toBe("10000000000000");
    expect(row.split.vendorClawback).toBeUndefined();
    expect(row.split.platformPromoReversal).toBeUndefined();
  });

  /**
   * *"Customer collected the order in full"* is not a line to render to the
   * customer it is about, however true it is. They get the label instead.
   */
  it("never sees a staff note", async () => {
    const { data } = await getRefunds(customer(CUSTOMER_A));
    const asText = JSON.stringify(data);

    expect(asText).not.toContain("collected the order");
    expect(asText).not.toContain("Overrode the outlet");
    expect(data[0].vendorNote).toBeUndefined();
    expect(data[0].adminNote).toBeUndefined();
  });

  /**
   * ⚠️ Telling a customer the outlet ignored them starts a fight the platform
   * then has to referee, and it is not something they can act on.
   */
  it("is never told the outlet went silent", async () => {
    await seed({
      customerId: CUSTOMER_A,
      brandId: BRAND_A,
      subBrandId: OUTLET_1,
      status: REFUND_REQUEST_STATUS.VENDOR_TIMEOUT,
    });

    const { data } = await getRefunds(customer(CUSTOMER_A), {
      status: REFUND_REQUEST_STATUS.VENDOR_TIMEOUT,
    });

    expect(data[0].statusLabel).toBe(
      REFUND_CUSTOMER_LABEL[REFUND_REQUEST_STATUS.VENDOR_TIMEOUT],
    );
    expect(data[0].statusLabel).not.toMatch(/timeout|ignored|did not respond/i);
  });
});

describe("an admin sees the whole thing", () => {
  it("reads every part of the split", async () => {
    const { data } = await getRefunds(admin());
    const row = data[0];

    expect(row.split.platformPromoReversal).toBe(35);
    expect(row.split.gatewayFeeAbsorbed).toBe(17.94);
    expect(row.split.commissionReversal).toBe(24);
    expect(row.adminNote).toMatch(/overrode the outlet/i);
    expect(row.customerId).toBeTruthy();
  });
});

describe("the worklist", () => {
  it("puts the oldest first, because it is closest to timing out", async () => {
    await clearCollections(RefundRequest);
    const older = await seed({
      customerId: CUSTOMER_A,
      brandId: BRAND_A,
      subBrandId: OUTLET_1,
      createdAt: new Date(Date.now() - 20 * HOUR),
    });
    await seed({
      customerId: CUSTOMER_B,
      brandId: BRAND_A,
      subBrandId: OUTLET_1,
      createdAt: new Date(Date.now() - HOUR),
    });

    const { data } = await getRefunds(vendor(BRAND_A), { open: true });
    expect(String(data[0]._id)).toBe(String(older._id));
  });

  it("puts the newest first when browsing history", async () => {
    await clearCollections(RefundRequest);
    await seed({
      customerId: CUSTOMER_A,
      brandId: BRAND_A,
      subBrandId: OUTLET_1,
      createdAt: new Date(Date.now() - 20 * HOUR),
    });
    const newer = await seed({
      customerId: CUSTOMER_B,
      brandId: BRAND_A,
      subBrandId: OUTLET_1,
      createdAt: new Date(Date.now() - HOUR),
    });

    const { data } = await getRefunds(vendor(BRAND_A));
    expect(String(data[0]._id)).toBe(String(newer._id));
  });

  it("filters to what is still moving", async () => {
    await seed({
      customerId: CUSTOMER_B,
      brandId: BRAND_A,
      subBrandId: OUTLET_1,
      status: REFUND_REQUEST_STATUS.VENDOR_REJECTED,
    });

    const open = await getRefunds(vendor(BRAND_A), { open: true });
    const closed = await getRefunds(vendor(BRAND_A), { open: false });

    expect(open.data.every((r) => r.isOpen)).toBe(true);
    expect(closed.data.every((r) => !r.isOpen)).toBe(true);
  });

  /**
   * Stated rather than inferred. A panel that works this out from the status
   * will get it wrong the first time a new state is added.
   */
  it("says who may act, per audience", async () => {
    const forVendor = await getRefunds(vendor(BRAND_A));
    const forCustomer = await getRefunds(customer(CUSTOMER_A));

    expect(forVendor.data[0].canDecide).toBe(true);
    expect(forVendor.data[0].canWithdraw).toBe(false);
    expect(forCustomer.data[0].canWithdraw).toBe(true);
    expect(forCustomer.data[0].canDecide).toBe(false);
  });
});

describe("the scope cannot be widened from the query string", () => {
  it("returns nothing rather than substituting the caller's own brand", async () => {
    const { data } = await getRefunds(vendor(BRAND_A), {
      brandId: String(BRAND_B),
    });
    expect(data).toHaveLength(0);
  });

  it("honours a filter that agrees with the scope", async () => {
    const { data } = await getRefunds(vendor(BRAND_A), {
      brandId: String(BRAND_A),
    });
    expect(data).toHaveLength(2);
  });

  it("refuses a caller with no scope rather than returning everything", async () => {
    await expect(getRefunds({ role: ROLES.VENDOR })).rejects.toThrow(
      /no brand is linked/i,
    );
    await expect(getRefunds({})).rejects.toThrow(/not authorized/i);
  });
});

describe("opening one refund", () => {
  it("carries the claim and the story so far", async () => {
    const request = await RefundRequest.findOne({ customerId: CUSTOMER_A }).lean();
    const result = await getRefundDetail(customer(CUSTOMER_A), request._id);

    expect(String(result.refund._id)).toBe(String(request._id));
    expect(result.claim).toBeTruthy();
    expect(Array.isArray(result.timeline)).toBe(true);
    expect(result.viewer.scope).toBe("OWN");
  });

  it("refuses another customer", async () => {
    const request = await RefundRequest.findOne({ customerId: CUSTOMER_A }).lean();
    await expect(
      getRefundDetail(customer(CUSTOMER_B), request._id),
    ).rejects.toThrow(/not authorized/i);
  });

  it("refuses another brand", async () => {
    const request = await RefundRequest.findOne({ brandId: BRAND_A }).lean();
    await expect(getRefundDetail(vendor(BRAND_B), request._id)).rejects.toThrow(
      /not authorized/i,
    );
  });

  it("refuses an outlet the claim was not made at", async () => {
    const request = await RefundRequest.findOne({ subBrandId: OUTLET_1 }).lean();
    await expect(
      getRefundDetail(subVendor(BRAND_A, OUTLET_2), request._id),
    ).rejects.toThrow(/different outlet/i);
  });

  it("is a 404 for one that does not exist", async () => {
    await expect(getRefundDetail(admin(), oid())).rejects.toThrow(/not found/i);
  });

  /**
   * The detail reads the row whole to check ownership, then narrows through a
   * whitelist — so it must land in exactly the same place as the listing.
   */
  it("narrows the detail exactly as the listing does", async () => {
    const request = await RefundRequest.findOne({ brandId: BRAND_A }).lean();
    const { refund } = await getRefundDetail(vendor(BRAND_A), request._id);

    const allowed = new Set(
      Object.keys(refundProjection(ROLES.VENDOR))
        .map((path) => path.split(".")[0])
        // Added by `presentRefund`, not by the projection.
        .concat(["statusLabel", "canDecide", "canWithdraw"]),
    );

    const escaped = Object.keys(refund).filter((key) => !allowed.has(key));
    expect(escaped).toEqual([]);
  });
});
