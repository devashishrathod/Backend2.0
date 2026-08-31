const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const VoucherClaim = require("../../models/VoucherClaim");
const VoucherClaimHistory = require("../../models/VoucherClaimHistory");
const { getClaimDetail } = require("../../services/voucherClaims");
const { buildClaimTimeline } = require("../../helpers/voucherClaims");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");
const {
  VOUCHER_CLAIM_STATUS,
  CLAIM_HISTORY_ACTION,
  CLAIM_PERFORMED_BY,
  CLAIM_TIMELINE_LABEL,
} = require("../../constants/voucherClaim");
const { ROLES, PAYMENT_STATUS } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();

let CUSTOMER_A;
let BRAND_A;
let BRAND_B;
let OUTLET_1;
let OUTLET_2;
let claim;
let txn;

const customer = (id) => ({ role: ROLES.CUSTOMER, customerId: id });
const vendor = (brandId) => ({ role: ROLES.VENDOR, brandId });
const subVendor = (brandId, subBrandId) => ({
  role: ROLES.SUB_VENDOR,
  brandId,
  subBrandId,
});
const admin = () => ({ role: ROLES.ADMIN });

/**
 * The snapshot as `createVoucherClaimOrder` actually writes it — the whole
 * pricing block, our promo share included. That is the field this milestone
 * exists to keep off a vendor's page.
 */
const REAL_SNAPSHOT = {
  pricing: {
    billAmount: 1000,
    offerDiscount: 200,
    netBill: 800,
    convenienceFee: 10,
    platformPromoCost: 35,
    vendorPayable: 800,
    totalPayable: 810,
  },
  razorpayOrderId: "order_secretlookingid",
  promoCode: "SAVE20",
};

beforeAll(async () => {
  await connectTestDb();
  for (const m of [Transaction, VoucherClaim, VoucherClaimHistory]) {
    await m.createIndexes();
  }
});

afterAll(async () => {
  await clearCollections(Transaction, VoucherClaim, VoucherClaimHistory);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(Transaction, VoucherClaim, VoucherClaimHistory);
  CUSTOMER_A = oid();
  BRAND_A = oid();
  BRAND_B = oid();
  OUTLET_1 = oid();
  OUTLET_2 = oid();

  const claimId = oid();

  txn = await Transaction.create({
    purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
    gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
    customerId: CUSTOMER_A,
    brandId: BRAND_A,
    subBrandId: OUTLET_1,
    amount: 810,
    status: PAYMENT_STATUS.CAPTURED,
    verified: true,
    paymentMethod: "upi",
    gatewayFee: 17.94,
    netReceived: 792.06,
    email: "customer@example.com",
    contact: "9700000001",
    invoiceToken: "b".repeat(64),
    voucher: {
      claimId,
      billAmount: 1000,
      offerDiscount: 200,
      netBill: 800,
      convenienceFee: 10,
      vendorPayable: 800,
      platformPromoCost: 35,
    },
  });

  claim = await VoucherClaim.create({
    _id: claimId,
    customerId: CUSTOMER_A,
    voucherId: oid(),
    voucherVersionId: oid(),
    versionNumber: 1,
    brandId: BRAND_A,
    subBrandId: OUTLET_1,
    billAmount: 1000,
    pricing: {
      billAmount: 1000,
      offerDiscount: 200,
      netBill: 800,
      convenienceFee: 10,
      platformPromoCost: 35,
      vendorPayable: 800,
      totalPayable: 810,
      amountInPaise: 81000,
      youSaved: 200,
    },
    transactionId: txn._id,
    status: VOUCHER_CLAIM_STATUS.REDEEMED,
    claimCode: "TD-ACD349",
    voucherSnapshot: { name: "Test Voucher" },
    brandSnapshot: { name: "test brand" },
    outletSnapshot: { storeId: "T-01" },
  });

  // Written out of order on purpose — a timeline that only looks right because
  // the rows were inserted in order is not sorting anything.
  await VoucherClaimHistory.create([
    {
      claimId,
      customerId: CUSTOMER_A,
      brandId: BRAND_A,
      action: CLAIM_HISTORY_ACTION.REDEEMED,
      performedByRole: CLAIM_PERFORMED_BY.VENDOR,
      performedBy: oid(),
      fromStatus: VOUCHER_CLAIM_STATUS.PAID,
      toStatus: VOUCHER_CLAIM_STATUS.REDEEMED,
      createdAt: new Date("2026-08-20T12:00:00Z"),
    },
    {
      claimId,
      customerId: CUSTOMER_A,
      brandId: BRAND_A,
      action: CLAIM_HISTORY_ACTION.CLAIM_CREATED,
      performedByRole: CLAIM_PERFORMED_BY.CUSTOMER,
      toStatus: VOUCHER_CLAIM_STATUS.PENDING,
      amount: 810,
      snapshot: REAL_SNAPSHOT,
      createdAt: new Date("2026-08-20T10:00:00Z"),
    },
    {
      claimId,
      customerId: CUSTOMER_A,
      brandId: BRAND_A,
      transactionId: txn._id,
      action: CLAIM_HISTORY_ACTION.PAYMENT_CAPTURED,
      performedByRole: CLAIM_PERFORMED_BY.SYSTEM,
      fromStatus: VOUCHER_CLAIM_STATUS.PENDING,
      toStatus: VOUCHER_CLAIM_STATUS.PAID,
      amount: 810,
      // A staff note, written for staff.
      reason: "Captured via webhook; customer disputes the bill amount",
      snapshot: { razorpayPaymentId: "pay_abc123" },
      createdAt: new Date("2026-08-20T11:00:00Z"),
    },
    {
      claimId,
      customerId: CUSTOMER_A,
      brandId: BRAND_A,
      action: CLAIM_HISTORY_ACTION.PROMO_RELEASED,
      performedByRole: CLAIM_PERFORMED_BY.SYSTEM,
      reason: "Reservation released back to the campaign budget",
      snapshot: { platformPromoCost: 35 },
      createdAt: new Date("2026-08-20T13:00:00Z"),
    },
  ]);
});

describe("the timeline never hands over the raw audit row", () => {
  /**
   * ⚠️ The one that matters.
   *
   * `snapshot` is `Mixed` and today holds the whole pricing block — our
   * `platformPromoCost` included. Rendering the audit row as-is would hand a
   * vendor our margin through the back door, past the projection that exists
   * to hide it, and would keep doing so for every field a future call site
   * decides to stash in there.
   */
  it("keeps our margin out of the vendor's story", async () => {
    const { timeline } = await getClaimDetail(vendor(BRAND_A), {
      claimId: claim._id,
    });

    const asText = JSON.stringify(timeline);
    expect(asText).not.toContain("platformPromoCost");
    expect(asText).not.toContain("35");
    expect(timeline.every((row) => row.snapshot === undefined)).toBe(true);
  });

  it("keeps it out of the customer's story too", async () => {
    const { timeline } = await getClaimDetail(customer(CUSTOMER_A), {
      claimId: claim._id,
    });

    expect(JSON.stringify(timeline)).not.toContain("platformPromoCost");
    expect(timeline.every((row) => row.snapshot === undefined)).toBe(true);
  });

  /**
   * `reason` is free text written by staff for staff. "Customer disputes the
   * bill amount" is not a sentence to render to the customer it is about.
   */
  it("never renders a staff note to the person it is about", async () => {
    for (const actor of [customer(CUSTOMER_A), vendor(BRAND_A)]) {
      const { timeline } = await getClaimDetail(actor, { claimId: claim._id });
      expect(JSON.stringify(timeline)).not.toContain("disputes the bill");
      expect(timeline.every((row) => row.reason === undefined)).toBe(true);
    }
  });

  it("never names the person who acted", async () => {
    const { timeline } = await getClaimDetail(customer(CUSTOMER_A), {
      claimId: claim._id,
    });
    // A role is a real answer for an auditor and is not sensitive. A user id is.
    expect(timeline.every((row) => row.performedBy === undefined)).toBe(true);
    expect(timeline.some((row) => row.by === CLAIM_PERFORMED_BY.VENDOR)).toBe(true);
  });

  it("gives an admin the whole forensic row", async () => {
    const { timeline } = await getClaimDetail(admin(), { claimId: claim._id });

    const created = timeline.find(
      (r) => r.action === CLAIM_HISTORY_ACTION.CLAIM_CREATED,
    );
    expect(created.snapshot.pricing.platformPromoCost).toBe(35);

    const captured = timeline.find(
      (r) => r.action === CLAIM_HISTORY_ACTION.PAYMENT_CAPTURED,
    );
    expect(captured.reason).toMatch(/disputes the bill/);
    expect(String(captured.transactionId)).toBe(String(txn._id));
  });

  /**
   * A built timeline rather than a filtered one: a field added to the audit
   * trail tomorrow is invisible by default instead of exposed by default.
   */
  it("does not carry a field added to the audit row later", async () => {
    await VoucherClaimHistory.collection.updateOne(
      { claimId: claim._id, action: CLAIM_HISTORY_ACTION.REDEEMED },
      { $set: { internalRiskScore: 0.93 } },
    );

    const { timeline } = await getClaimDetail(vendor(BRAND_A), {
      claimId: claim._id,
    });
    expect(JSON.stringify(timeline)).not.toContain("internalRiskScore");
  });
});

describe("what the timeline does say", () => {
  it("reads forwards, oldest first", async () => {
    const { timeline } = await getClaimDetail(customer(CUSTOMER_A), {
      claimId: claim._id,
    });

    expect(timeline.map((r) => r.action)).toEqual([
      CLAIM_HISTORY_ACTION.CLAIM_CREATED,
      CLAIM_HISTORY_ACTION.PAYMENT_CAPTURED,
      CLAIM_HISTORY_ACTION.REDEEMED,
    ]);
  });

  it("hides our own budget bookkeeping", async () => {
    const { timeline } = await getClaimDetail(customer(CUSTOMER_A), {
      claimId: claim._id,
    });
    expect(
      timeline.some((r) => r.action === CLAIM_HISTORY_ACTION.PROMO_RELEASED),
    ).toBe(false);

    const forAdmin = await getClaimDetail(admin(), { claimId: claim._id });
    expect(
      forAdmin.timeline.some(
        (r) => r.action === CLAIM_HISTORY_ACTION.PROMO_RELEASED,
      ),
    ).toBe(true);
  });

  it("renders a sentence, not a raw enum", async () => {
    const { timeline } = await getClaimDetail(customer(CUSTOMER_A), {
      claimId: claim._id,
    });

    expect(timeline[0].label).toBe(
      CLAIM_TIMELINE_LABEL[CLAIM_HISTORY_ACTION.CLAIM_CREATED],
    );
    expect(timeline[1].fromStatus).toBe(VOUCHER_CLAIM_STATUS.PENDING);
    expect(timeline[1].toStatus).toBe(VOUCHER_CLAIM_STATUS.PAID);
  });

  /**
   * A new action added without a label should look unfamiliar, not invisible —
   * a blank row on a timeline reads as a rendering bug, and someone will chase
   * it instead of the missing label.
   */
  it("still renders an action nobody wrote a label for", async () => {
    await VoucherClaimHistory.collection.insertOne({
      claimId: claim._id,
      customerId: CUSTOMER_A,
      brandId: BRAND_A,
      action: "SOMETHING_NEW",
      performedByRole: CLAIM_PERFORMED_BY.SYSTEM,
      createdAt: new Date("2026-08-20T14:00:00Z"),
    });

    const timeline = await buildClaimTimeline({
      claimId: claim._id,
      role: ROLES.CUSTOMER,
    });
    const row = timeline.find((r) => r.action === "SOMETHING_NEW");
    expect(row.label).toBe("SOMETHING_NEW");
  });

  it("is empty rather than absent for a claim with no history", async () => {
    await VoucherClaimHistory.deleteMany({ claimId: claim._id });
    const { timeline } = await getClaimDetail(admin(), { claimId: claim._id });
    expect(timeline).toEqual([]);
  });
});

describe("opening a claim by the code at the counter", () => {
  it("finds it by code", async () => {
    const result = await getClaimDetail(subVendor(BRAND_A, OUTLET_1), {
      claimCode: claim.claimCode,
    });
    expect(String(result.claim._id)).toBe(String(claim._id));
  });

  it("accepts the code lower-cased, the way it gets typed", async () => {
    const result = await getClaimDetail(vendor(BRAND_A), {
      claimCode: claim.claimCode.toLowerCase(),
    });
    expect(result.claim.claimCode).toBe(claim.claimCode);
  });

  /**
   * The code narrows the lookup; it does not authorise it. A code read off
   * someone else's screen still opens nothing.
   */
  it("does not let a guessed code substitute for access", async () => {
    await expect(
      getClaimDetail(vendor(BRAND_B), { claimCode: claim.claimCode }),
    ).rejects.toThrow(/not authorized/i);

    await expect(
      getClaimDetail(subVendor(BRAND_A, OUTLET_2), { claimCode: claim.claimCode }),
    ).rejects.toThrow(/not made at your outlet/i);
  });

  it("is a 404 for a code that matches nothing", async () => {
    await expect(
      getClaimDetail(admin(), { claimCode: "TD-XXXXXX" }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("the claim page carries its payment, narrowed the same way", () => {
  it("hides our margin on the attached payment", async () => {
    const { payment } = await getClaimDetail(vendor(BRAND_A), {
      claimId: claim._id,
    });

    expect(payment.gatewayFee).toBeUndefined();
    expect(payment.netReceived).toBeUndefined();
    expect(payment.email).toBeUndefined();
    expect(payment.voucher.vendorPayable).toBe(800);
  });

  it("gives the customer their invoice link and not the token", async () => {
    const previous = process.env.PUBLIC_API_URL;
    process.env.PUBLIC_API_URL = "https://api.example.com";

    try {
      const { payment } = await getClaimDetail(customer(CUSTOMER_A), {
        claimId: claim._id,
      });
      expect(payment.invoiceDownloadUrl).toContain("/transactions/invoice/");
      expect(payment.invoiceToken).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.PUBLIC_API_URL;
      else process.env.PUBLIC_API_URL = previous;
    }
  });

  /**
   * One collection holds both money flows. A claim whose `transactionId` was
   * ever mis-set must surface nothing rather than a subscription row.
   */
  it("will not attach a subscription payment", async () => {
    const subscription = await Transaction.create({
      purpose: TRANSACTION_PURPOSE.SUBSCRIPTION,
      gatewayAccount: RAZORPAY_ACCOUNTS.VENDOR,
      brandId: BRAND_A,
      amount: 4999,
    });
    await VoucherClaim.updateOne(
      { _id: claim._id },
      { $set: { transactionId: subscription._id } },
    );

    const { payment } = await getClaimDetail(admin(), { claimId: claim._id });
    expect(payment).toBeNull();
  });
});
