const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const VoucherClaim = require("../../models/VoucherClaim");
const { getClaimTransactionDetail } = require("../../services/voucherClaims");
const {
  claimProjection,
  claimRecordProjection,
  pickByProjection,
} = require("../../helpers/transactions");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
  GATEWAY_FEE_BEARER,
} = require("../../constants/transaction");
const { VOUCHER_CLAIM_STATUS } = require("../../constants/voucherClaim");
const { ROLES, PAYMENT_STATUS } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();

let CUSTOMER_A;
let BRAND_A;
let BRAND_B;
let OUTLET_1;
let OUTLET_2;
let txn;
let claim;

const customer = (id) => ({ role: ROLES.CUSTOMER, customerId: id });
const vendor = (brandId) => ({ role: ROLES.VENDOR, brandId });
const subVendor = (brandId, subBrandId) => ({
  role: ROLES.SUB_VENDOR,
  brandId,
  subBrandId,
});
const admin = () => ({ role: ROLES.ADMIN });

const seed = async ({ customerId, brandId, subBrandId }) => {
  const claimId = oid();

  const transaction = await Transaction.create({
    purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
    gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
    customerId,
    brandId,
    subBrandId,
    amount: 810,
    status: PAYMENT_STATUS.CAPTURED,
    verified: true,
    paymentMethod: "upi",
    razorpayOrderId: `order_${Math.random().toString(36).slice(2, 12)}`,
    razorpayPaymentId: `pay_${Math.random().toString(36).slice(2, 12)}`,
    // The three a vendor must never read.
    gatewayFee: 17.94,
    netReceived: 792.06,
    gatewayFeeBearer: GATEWAY_FEE_BEARER.PLATFORM,
    email: "customer@example.com",
    contact: "9700000001",
    invoiceId: `TD/VCH/26-27/${Math.floor(Math.random() * 1e6)}`,
    invoiceToken: "a".repeat(64),
    voucher: {
      claimId,
      billAmount: 1000,
      offerDiscount: 200,
      netBill: 800,
      convenienceFee: 10,
      vendorPayable: 800,
      platformPromoCost: 35,
      vendorPromoCost: 0,
    },
  });

  const claimDoc = await VoucherClaim.create({
    _id: claimId,
    customerId,
    voucherId: oid(),
    voucherVersionId: oid(),
    versionNumber: 1,
    brandId,
    subBrandId,
    billAmount: 1000,
    pricing: {
      billAmount: 1000,
      offerDiscount: 200,
      netBill: 800,
      convenienceFee: 10,
      promoDiscount: 0,
      vendorPromoCost: 0,
      platformPromoCost: 35,
      totalPayable: 810,
      amountInPaise: 81000,
      youSaved: 200,
      vendorPayable: 800,
      offerTitle: "20% off",
    },
    transactionId: transaction._id,
    status: VOUCHER_CLAIM_STATUS.REDEEMED,
    claimCode: `TD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    voucherSnapshot: { name: "Test Voucher" },
    brandSnapshot: { name: "test brand" },
    outletSnapshot: { storeId: "T-01" },
  });

  return { transaction, claim: claimDoc };
};

beforeAll(async () => {
  await connectTestDb();
  for (const m of [Transaction, VoucherClaim]) await m.createIndexes();
});

afterAll(async () => {
  await clearCollections(Transaction, VoucherClaim);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(Transaction, VoucherClaim);
  CUSTOMER_A = oid();
  BRAND_A = oid();
  BRAND_B = oid();
  OUTLET_1 = oid();
  OUTLET_2 = oid();

  ({ transaction: txn, claim } = await seed({
    customerId: CUSTOMER_A,
    brandId: BRAND_A,
    subBrandId: OUTLET_1,
  }));
});

describe("who may open one payment", () => {
  it("lets the customer who paid", async () => {
    const result = await getClaimTransactionDetail(
      customer(CUSTOMER_A),
      txn._id,
    );
    expect(String(result.payment._id)).toBe(String(txn._id));
    expect(result.viewer.scope).toBe("OWN");
  });

  it("lets the brand it was paid to", async () => {
    const result = await getClaimTransactionDetail(vendor(BRAND_A), txn._id);
    expect(result.viewer.scope).toBe("BRAND");
  });

  it("refuses another customer", async () => {
    await expect(
      getClaimTransactionDetail(customer(oid()), txn._id),
    ).rejects.toThrow(/not authorized/i);
  });

  it("refuses another brand", async () => {
    await expect(
      getClaimTransactionDetail(vendor(BRAND_B), txn._id),
    ).rejects.toThrow(/not authorized/i);
  });

  it("refuses an outlet the payment was not taken at", async () => {
    await expect(
      getClaimTransactionDetail(subVendor(BRAND_A, OUTLET_2), txn._id),
    ).rejects.toThrow(/not taken at your outlet/i);
  });

  /**
   * A 404, not a 403. "You may not see this" about a row that does not exist
   * tells a prober that it does.
   */
  it("answers 404 for a row that does not exist", async () => {
    await expect(getClaimTransactionDetail(admin(), oid())).rejects.toThrow(
      /not found/i,
    );
  });

  /**
   * ⚠️ One collection holds two money flows. Without the `purpose` scope this
   * endpoint would open a **subscription** payment by id — a vendor's own
   * billing row, on the other Razorpay account, through a projection designed
   * for a voucher claim. The id being unique is not the point.
   */
  it("will not open a subscription payment by id", async () => {
    const subscription = await Transaction.create({
      purpose: TRANSACTION_PURPOSE.SUBSCRIPTION,
      gatewayAccount: RAZORPAY_ACCOUNTS.VENDOR,
      brandId: BRAND_A,
      amount: 4999,
      verified: true,
    });

    await expect(
      getClaimTransactionDetail(admin(), subscription._id),
    ).rejects.toThrow(/not found/i);
  });
});

describe("a detail page never shows what the listing hides", () => {
  /**
   * The listing projects inside the pipeline; the detail cannot, because
   * ownership lives in the very fields the vendor projection omits. So it reads
   * whole, checks, then narrows — and the narrowing must land in the same place.
   */
  it("hides our margin from the vendor", async () => {
    const { payment } = await getClaimTransactionDetail(
      vendor(BRAND_A),
      txn._id,
    );

    expect(payment.gatewayFee).toBeUndefined();
    expect(payment.netReceived).toBeUndefined();
    expect(payment.voucher.platformPromoCost).toBeUndefined();
  });

  it("hides the customer's details from the vendor", async () => {
    const { payment } = await getClaimTransactionDetail(
      vendor(BRAND_A),
      txn._id,
    );

    expect(payment.email).toBeUndefined();
    expect(payment.contact).toBeUndefined();
    expect(payment.customerId).toBeUndefined();
  });

  it("shows the vendor what they will be paid", async () => {
    const { payment } = await getClaimTransactionDetail(
      vendor(BRAND_A),
      txn._id,
    );
    expect(payment.voucher.vendorPayable).toBe(800);
  });

  it("hides our margin from the customer too", async () => {
    const { payment } = await getClaimTransactionDetail(
      customer(CUSTOMER_A),
      txn._id,
    );

    expect(payment.gatewayFee).toBeUndefined();
    expect(payment.voucher.platformPromoCost).toBeUndefined();
    // They do see the fee they were charged.
    expect(payment.voucher.convenienceFee).toBe(10);
  });

  it("shows an admin the whole row", async () => {
    const { payment } = await getClaimTransactionDetail(admin(), txn._id);

    expect(payment.gatewayFee).toBe(17.94);
    expect(payment.netReceived).toBe(792.06);
    expect(payment.voucher.platformPromoCost).toBe(35);
    expect(payment.email).toBe("customer@example.com");
  });

  /**
   * The claim rides along, and it is narrowed by the same per-audience rules —
   * otherwise the promo split we absorbed would be hidden on the payment and
   * visible one key over on the claim.
   */
  it("hides our share of a promo on the attached claim as well", async () => {
    const { claim: forVendor } = await getClaimTransactionDetail(
      vendor(BRAND_A),
      txn._id,
    );

    expect(forVendor.pricing.platformPromoCost).toBeUndefined();
    expect(forVendor.pricing.vendorPayable).toBe(800);
    expect(forVendor.customerId).toBeUndefined();
  });
});

describe("what the page needs to render", () => {
  it("carries the frozen snapshots, not a live join", async () => {
    const { claim: attached } = await getClaimTransactionDetail(
      customer(CUSTOMER_A),
      txn._id,
    );

    // Still correct in March, after the voucher is republished and the outlet
    // renamed.
    expect(attached.voucherSnapshot.name).toBe("Test Voucher");
    expect(attached.outletSnapshot.storeId).toBe("T-01");
    expect(attached.claimCode).toBe(claim.claimCode);
  });

  it("tells the client what it may render instead of making it guess", async () => {
    const { viewer } = await getClaimTransactionDetail(
      vendor(BRAND_A),
      txn._id,
    );

    expect(viewer.role).toBe(ROLES.VENDOR);
    expect(viewer.canSeePlatformCosts).toBe(false);
    expect(viewer.canSeeCustomerContact).toBe(false);
  });

  it("carries the payment method and the moment it happened", async () => {
    const { payment } = await getClaimTransactionDetail(
      customer(CUSTOMER_A),
      txn._id,
    );

    expect(payment.paymentMethod).toBe("upi");
    expect(payment.createdAt).toBeInstanceOf(Date);
    expect(payment.razorpayPaymentId).toMatch(/^pay_/);
  });

  /**
   * The raw token is an unauthenticated bearer credential for the PDF. The
   * assembled URL is the entire use for it; returning the token as well just
   * gives a client a second thing to leak.
   */
  it("hands back a download link, never the token behind it", async () => {
    const previous = process.env.PUBLIC_API_URL;
    process.env.PUBLIC_API_URL = "https://backend2-0-4v4i.onrender.com";

    try {
      const { payment } = await getClaimTransactionDetail(
        customer(CUSTOMER_A),
        txn._id,
      );
      expect(payment.invoiceDownloadUrl).toBe(
        `https://backend2-0-4v4i.onrender.com/trydood/v1/transactions/invoice/${"a".repeat(64)}`,
      );
      expect(payment.invoiceToken).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.PUBLIC_API_URL;
      else process.env.PUBLIC_API_URL = previous;
    }
  });

  /**
   * A Download button that goes nowhere is worse than no button, so an
   * unconfigured base yields no link rather than a broken one.
   */
  it("omits the link rather than building a dead one", async () => {
    const previous = process.env.PUBLIC_API_URL;
    delete process.env.PUBLIC_API_URL;

    try {
      const { payment } = await getClaimTransactionDetail(
        customer(CUSTOMER_A),
        txn._id,
      );
      expect(payment.invoiceDownloadUrl).toBeUndefined();
    } finally {
      if (previous !== undefined) process.env.PUBLIC_API_URL = previous;
    }
  });

  it("gives the vendor no invoice link at all", async () => {
    const previous = process.env.PUBLIC_API_URL;
    process.env.PUBLIC_API_URL = "https://backend2-0-4v4i.onrender.com";

    try {
      const { payment } = await getClaimTransactionDetail(
        vendor(BRAND_A),
        txn._id,
      );
      // The customer's tax invoice carries the customer's own details.
      expect(payment.invoiceDownloadUrl).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.PUBLIC_API_URL;
      else process.env.PUBLIC_API_URL = previous;
    }
  });

  /**
   * The claim is written before Razorpay is ever called, so the link resolves
   * for a payment that never completed — which is exactly when someone opens
   * the notification and asks what went wrong.
   */
  it("still opens when the payment never completed", async () => {
    const pendingClaimId = oid();
    const pending = await Transaction.create({
      purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
      gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
      customerId: CUSTOMER_A,
      brandId: BRAND_A,
      subBrandId: OUTLET_1,
      amount: 810,
      status: PAYMENT_STATUS.CREATED,
      verified: false,
      voucher: { claimId: pendingClaimId, billAmount: 1000 },
    });
    await VoucherClaim.create({
      _id: pendingClaimId,
      customerId: CUSTOMER_A,
      voucherId: oid(),
      voucherVersionId: oid(),
      versionNumber: 1,
      brandId: BRAND_A,
      subBrandId: OUTLET_1,
      billAmount: 1000,
      pricing: { billAmount: 1000, totalPayable: 810, amountInPaise: 81000 },
      transactionId: pending._id,
      status: VOUCHER_CLAIM_STATUS.PENDING,
      claimCode: "TD-PEND01",
      voucherSnapshot: { name: "Test Voucher" },
    });

    const { payment, claim: attached } = await getClaimTransactionDetail(
      customer(CUSTOMER_A),
      pending._id,
    );

    expect(payment.verified).toBe(false);
    expect(attached.status).toBe(VOUCHER_CLAIM_STATUS.PENDING);
    expect(payment.invoiceDownloadUrl).toBeUndefined();
  });
});

describe("the whitelist fails closed", () => {
  /**
   * `delete doc.gatewayFee` has to be updated every time the model grows a
   * field, and the day someone forgets is the day a vendor reads our margin.
   * A whitelist fails the other way: a new field is invisible until named.
   */
  it("does not carry a field nobody asked for", () => {
    const picked = pickByProjection(
      { _id: 1, amount: 810, somethingAddedLater: "leak" },
      { _id: 1, amount: 1 },
    );

    expect(picked.somethingAddedLater).toBeUndefined();
    expect(Object.keys(picked)).toEqual(["_id", "amount"]);
  });

  it("does not invent a key for a value the document never had", () => {
    // Copying `undefined` through would turn every unset optional field into an
    // explicit null, which reads as "we know it is empty" rather than "not set".
    const picked = pickByProjection({ _id: 1 }, { _id: 1, refundedAt: 1 });
    expect("refundedAt" in picked).toBe(false);
  });

  it("reads a dotted path without dragging its siblings along", () => {
    const picked = pickByProjection(
      { voucher: { vendorPayable: 800, platformPromoCost: 35 } },
      { "voucher.vendorPayable": 1 },
    );

    expect(picked.voucher).toEqual({ vendorPayable: 800 });
  });

  /**
   * The listing and the detail must narrow to the same thing. If they ever
   * diverge, one is showing a field the other decided to hide — and the detail
   * is the one nobody thinks to check.
   *
   * Asserted against the service's real output rather than by comparing the
   * projection to itself, which is true no matter what the endpoint does.
   */
  it("returns nothing the audience's projection did not name", async () => {
    for (const actor of [
      customer(CUSTOMER_A),
      vendor(BRAND_A),
      subVendor(BRAND_A, OUTLET_1),
      admin(),
    ]) {
      const { payment } = await getClaimTransactionDetail(actor, txn._id);

      // Top-level keys the projection names, plus the one the service adds.
      const allowed = new Set(
        Object.keys(claimProjection(actor.role))
          .map((path) => path.split(".")[0])
          .concat("invoiceDownloadUrl"),
      );

      const escaped = Object.keys(payment).filter((key) => !allowed.has(key));
      expect({ role: actor.role, escaped }).toEqual({
        role: actor.role,
        escaped: [],
      });
    }
  });

  it("agrees with the claim projection about our costs", () => {
    for (const role of [ROLES.CUSTOMER, ROLES.VENDOR, ROLES.SUB_VENDOR]) {
      // The payment view and the claim view must hide the same things, or the
      // promo split we absorbed is hidden on one and visible one key over.
      expect(claimProjection(role).gatewayFee).toBeUndefined();
      expect(claimProjection(role).netReceived).toBeUndefined();
      expect(claimRecordProjection(role).pricing).toBeUndefined();
      expect(
        claimRecordProjection(role)["pricing.platformPromoCost"],
      ).toBeUndefined();
    }
    // The admin view is the control: if this ever stops being visible, the
    // assertions above start passing for the wrong reason.
    expect(claimProjection(ROLES.ADMIN).gatewayFee).toBe(1);
    expect(claimRecordProjection(ROLES.ADMIN).pricing).toBe(1);
  });
});
