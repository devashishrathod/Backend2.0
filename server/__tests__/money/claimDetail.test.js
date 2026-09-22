const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const VoucherClaim = require("../../models/VoucherClaim");
const Brand = require("../../models/Brand");
const Customer = require("../../models/Customer");
const VoucherVersion = require("../../models/VoucherVersion");
const Follow = require("../../models/Follow");
const BrandAvoidance = require("../../models/BrandAvoidance");
// The real generator — `merchantId` is HMAC-derived from `MERCHANT_ID_SECRET`,
// so a hand-written string fails validation.
const { generateBrandMerchantId } = require("../../helpers/brands");
const {
  getClaimTransactionDetail,
  getClaimDetail,
} = require("../../services/voucherClaims");
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
const { VOUCHER_DISCOUNT_TYPES } = require("../../constants/voucher");
const { ROLES, PAYMENT_STATUS } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();
const DAY_MS = 24 * 60 * 60 * 1000;

let CUSTOMER_A;
let BRAND_A;
let BRAND_B;
let OUTLET_1;
let OUTLET_2;
let txn;
let claim;
let VERSION;

/**
 * Real documents behind `customerId` and `voucherVersionId`.
 *
 * The detail endpoints read both collections now. Against an id that matches
 * nothing the service returns `null`, which is indistinguishable from an
 * audience that is not shown the block at all — so the two cases can only be
 * told apart if the documents actually exist.
 */
let codeSeq = 95_000_000;

const seedVersion = async (brandId) =>
  VoucherVersion.create({
    voucherId: oid(),
    brandId,
    createdBy: oid(),
    categoryId: oid(),
    subCategoryId: oid(),
    name: "Test Voucher",
    versionNumber: 4,
    versionCode: `VCH-${String(codeSeq++).padStart(8, "0")}-V1`,
    startAt: new Date(Date.now() - DAY_MS),
    endAt: new Date(Date.now() + 90 * DAY_MS),
    images: [
      { media: { url: "https://cdn.test/one.webp", kind: "IMAGE" }, sortOrder: 1 },
    ],
    offers: [
      {
        title: "20% off",
        minBillAmount: 100,
        discountType: VOUCHER_DISCOUNT_TYPES.PERCENTAGE,
        discountValue: 20,
        sortOrder: 1,
      },
    ],
  });

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
    documentToken: "a".repeat(64),
    voucher: {
      claimId,
      voucherVersionId: VERSION._id,
      versionNumber: VERSION.versionNumber,
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
    voucherVersionId: VERSION._id,
    versionNumber: VERSION.versionNumber,
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

const MODELS = [
  Transaction,
  VoucherClaim,
  Customer,
  VoucherVersion,
  Follow,
  BrandAvoidance,
];

beforeAll(async () => {
  await connectTestDb();
  for (const m of MODELS) await m.createIndexes();
});

afterAll(async () => {
  await clearCollections(...MODELS);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(...MODELS);
  BRAND_A = oid();
  BRAND_B = oid();
  OUTLET_1 = oid();
  OUTLET_2 = oid();

  const [buyer, version] = await Promise.all([
    Customer.create({
      userId: oid(),
      uniqueId: "TDC000042",
      fullName: "Asha Menon",
      email: "asha@example.com",
      mobile: "9876543210",
      whatsappNumber: "9876543211",
    }),
    seedVersion(BRAND_A),
  ]);
  CUSTOMER_A = buyer._id;
  VERSION = version;

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

  /**
   * ⚠️ `canSeeCustomerContact` used to be `false` here, and this assertion was
   * changed deliberately rather than deleted.
   *
   * The brand side was given the buyer's **email** — so a flag saying "no
   * contact at all" became untrue. It could not simply be left alone either: a
   * panel that hides the whole customer block on `canSeeCustomerContact: false`
   * would have gone on hiding a field it was now being sent.
   *
   * `canSeeCustomerPhone` is what carries the part that did not move, and the
   * pair is asserted together so neither can drift away from
   * `customerIdentityProjection` unnoticed.
   */
  it("tells the client what it may render instead of making it guess", async () => {
    const { viewer } = await getClaimTransactionDetail(
      vendor(BRAND_A),
      txn._id,
    );

    expect(viewer.role).toBe(ROLES.VENDOR);
    expect(viewer.canSeePlatformCosts).toBe(false);
    // An email, yes.
    expect(viewer.canSeeCustomerContact).toBe(true);
    // The number, never.
    expect(viewer.canSeeCustomerPhone).toBe(false);
  });

  /**
   * The flags are a promise about the payload, so they are checked **against**
   * it rather than on their own. A boolean that agrees with nothing is worse
   * than no boolean: a client acts on it.
   */
  it("keeps the viewer flags honest about what actually came back", async () => {
    for (const actor of [vendor(BRAND_A), subVendor(BRAND_A, OUTLET_1), admin()]) {
      const { viewer, customer: buyer } = await getClaimTransactionDetail(
        actor,
        txn._id,
      );

      expect(Boolean(buyer?.email)).toBe(viewer.canSeeCustomerContact);
      expect(Boolean(buyer?.mobile)).toBe(viewer.canSeeCustomerPhone);
    }
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
        `https://backend2-0-4v4i.onrender.com/trydood/v1/documents/${"a".repeat(64)}`,
      );
      expect(payment.documentToken).toBeUndefined();
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

/**
 * 🔴 `brand.isFollowed` / `brand.isAvoided` describe **the viewer**, never the
 * buyer.
 *
 * These two endpoints have three audiences, so the flags had to be about
 * somebody. Answering about the buyer would tell a vendor "this customer has
 * you avoided" — the same class of disclosure `canSeeCustomerPhone: false`
 * refuses one field over. The helper reads `actor`, not
 * `transaction.customerId`; this pins the
 * **call site**, because the helper can be perfectly correct and still be handed
 * the wrong argument.
 */
describe("the brand block reports the viewer, not the buyer", () => {
  let BRAND_DOC;

  beforeEach(async () => {
    BRAND_DOC = await Brand.create({
      brandName: "fixture brand",
      uniqueId: `TDB${Date.now()}${Math.floor(Math.random() * 100000)}`,
      userId: oid(),
      merchantId: await generateBrandMerchantId(),
    });

    // Re-seed the money rows against the real brand, so `brand` is not null.
    await clearCollections(Transaction, VoucherClaim);
    ({ transaction: txn, claim } = await seed({
      customerId: CUSTOMER_A,
      brandId: BRAND_DOC._id,
      subBrandId: OUTLET_1,
    }));

    // The buyer both follows and avoids this brand — the strongest possible
    // signal, so a leak cannot hide behind a false that happened to be right.
    await Follow.create({
      followerId: CUSTOMER_A,
      followeeId: BRAND_DOC._id,
    });
    await BrandAvoidance.create({
      customerId: CUSTOMER_A,
      brandId: BRAND_DOC._id,
    });
  });

  afterEach(async () => {
    await clearCollections(Brand);
  });

  it("gives the buyer their own state on the payment detail", async () => {
    const result = await getClaimTransactionDetail(
      customer(CUSTOMER_A),
      String(txn._id),
    );

    expect(result.brand.isFollowed).toBe(true);
    expect(result.brand.isAvoided).toBe(true);
  });

  it("hides the buyer's state from the vendor who owns the brand", async () => {
    const result = await getClaimTransactionDetail(
      vendor(BRAND_DOC._id),
      String(txn._id),
    );

    expect(result.brand.isFollowed).toBe(false);
    expect(result.brand.isAvoided).toBe(false);
    // The control: the vendor really is looking at the right row.
    expect(result.viewer.scope).toBe("BRAND");
  });

  it("hides the buyer's state from the outlet and from an admin", async () => {
    for (const actor of [subVendor(BRAND_DOC._id, OUTLET_1), admin()]) {
      const result = await getClaimTransactionDetail(actor, String(txn._id));
      expect(result.brand.isFollowed).toBe(false);
      expect(result.brand.isAvoided).toBe(false);
    }
  });

  /**
   * The claim page states in its own comment that its `brand` is the same shape
   * as the payment page's. Adding a key to one and not the other is how a
   * detail page quietly starts carrying less than the page it was opened from.
   */
  it("keeps the claim detail's brand block the same shape", async () => {
    const payment = await getClaimTransactionDetail(
      customer(CUSTOMER_A),
      String(txn._id),
    );
    const claimPage = await getClaimDetail(customer(CUSTOMER_A), {
      claimId: String(claim._id),
    });

    expect(Object.keys(claimPage.brand).sort()).toEqual(
      Object.keys(payment.brand).sort(),
    );
    expect(claimPage.brand.isFollowed).toBe(true);
    expect(claimPage.brand.isAvoided).toBe(true);
  });

  it("hides the buyer's state from the vendor on the claim detail too", async () => {
    const result = await getClaimDetail(vendor(BRAND_DOC._id), {
      claimId: String(claim._id),
    });

    expect(result.brand.isFollowed).toBe(false);
    expect(result.brand.isAvoided).toBe(false);
  });
});

/**
 * ---------------- who paid, and which version ----------------
 *
 * Both blocks sit beside `brand` and `outlet` rather than inside `payment`,
 * because a detail response is a bundle and those are their two siblings in the
 * listing. The listing nests all four on the row; this endpoint returns the
 * payment as one member.
 */
describe("the customer and voucherVersion blocks on a detail page", () => {
  const openBoth = async (actor) => [
    await getClaimTransactionDetail(actor, String(txn._id)),
    await getClaimDetail(actor, { claimId: String(claim._id) }),
  ];

  /**
   * 🔴 Name, id and email — never the number.
   *
   * ⚠️ Mutation note: pass `actor.role` instead of `access.role` into
   * `customerIdentityProjection` and this still passes for a vendor token, which
   * is exactly why the customer case below is asserted separately.
   */
  it("gives the vendor a name, a unique id and an email on both endpoints", async () => {
    for (const result of await openBoth(vendor(BRAND_A))) {
      expect(result.customer.fullName).toBe("Asha Menon");
      expect(result.customer.uniqueId).toBe("TDC000042");
      expect(result.customer.email).toBe("asha@example.com");

      expect(result.customer.mobile).toBeUndefined();
      expect(result.customer.whatsappNumber).toBeUndefined();
      // The ObjectId the payment projection deliberately withholds must not
      // reappear one key deeper.
      expect(result.customer._id).toBeUndefined();
      expect(result.payment.customerId).toBeUndefined();
    }
  });

  it("gives an admin the phone numbers as well", async () => {
    for (const result of await openBoth(admin())) {
      expect(result.customer.email).toBe("asha@example.com");
      expect(result.customer.mobile).toBe("9876543210");
      expect(result.customer.whatsappNumber).toBe("9876543211");
    }
  });

  /**
   * `null`, and the key is still there.
   *
   * A missing key would make a client guess whether the block was withheld or
   * the lookup failed; `null` says "not shown" in the one shape the rest of this
   * response already uses for `outlet`.
   */
  it("gives the customer reading their own receipt no block at all", async () => {
    for (const result of await openBoth(customer(CUSTOMER_A))) {
      expect(result).toHaveProperty("customer");
      expect(result.customer).toBeNull();
    }
  });

  it("names the voucher version for every audience", async () => {
    for (const actor of [
      customer(CUSTOMER_A),
      vendor(BRAND_A),
      subVendor(BRAND_A, OUTLET_1),
      admin(),
    ]) {
      for (const result of await openBoth(actor)) {
        expect(result.voucherVersion.versionCode).toMatch(/^VCH-\d{8}-V1$/);
        expect(result.voucherVersion.versionNumber).toBe(4);
      }
    }
  });

  /**
   * The promise the two services make to each other in prose: a detail page
   * must never carry less than the page it was opened from, and these two are
   * read side by side by the same screens.
   */
  it("keeps both blocks the same shape across the two detail endpoints", async () => {
    const [payment, claimPage] = await openBoth(vendor(BRAND_A));

    expect(Object.keys(claimPage.customer).sort()).toEqual(
      Object.keys(payment.customer).sort(),
    );
    expect(Object.keys(claimPage.voucherVersion).sort()).toEqual(
      Object.keys(payment.voucherVersion).sort(),
    );
  });

  /**
   * ⚠️ Neither read filters `isDeleted`. A closed account does not unmake a sale
   * the brand will still be settled for, and a counter left with a row it cannot
   * identify is worse than a name belonging to somebody who has left.
   */
  it("still names a customer who has since closed their account", async () => {
    await Customer.updateOne(
      { _id: CUSTOMER_A },
      { $set: { isDeleted: true, isActive: false } },
    );

    const [payment] = await openBoth(vendor(BRAND_A));
    expect(payment.customer.fullName).toBe("Asha Menon");
  });
});
