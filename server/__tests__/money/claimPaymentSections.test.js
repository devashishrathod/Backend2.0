/**
 * The sections a claim payment is read in — outlet, voucher, pricing, payment
 * and the **vendor payout**.
 *
 * ### Why a real database
 *
 * Every one of these assembles a *different* document, and the two failures
 * worth catching are both invisible against a mock:
 *
 *  - an **inclusion projection naming a field that does not exist** returns
 *    nothing and raises nothing. That is exactly how `outlet.address` came back
 *    absent on every call this endpoint ever served — `SubBrand` has no
 *    `address` path at all — and how `claimProjection` promised an `email` that
 *    no code writes on a voucher-claim row. A mock returns whatever it was told
 *    to and would have agreed with both bugs.
 *  - the settlement section reads through `settlementProjection`, whose admin
 *    and vendor branches differ by a **path collision rule** Mongo enforces and
 *    JavaScript does not.
 */

const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const VoucherClaim = require("../../models/VoucherClaim");
const Brand = require("../../models/Brand");
const SubBrand = require("../../models/SubBrand");
const Location = require("../../models/Location");
const Customer = require("../../models/Customer");
const VoucherVersion = require("../../models/VoucherVersion");
const Settlement = require("../../models/Settlement");
const PayoutLeg = require("../../models/PayoutLeg");

const { generateBrandMerchantId } = require("../../helpers/brands");
const {
  generateSubBrandStoreId,
} = require("../../helpers/subBrands/generateSubBrandStoreId");
const {
  getClaimTransactionDetail,
  getClaimDetail,
} = require("../../services/voucherClaims");

const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
  GATEWAY_FEE_BEARER,
} = require("../../constants/transaction");
const { VOUCHER_CLAIM_STATUS } = require("../../constants/voucherClaim");
const { VOUCHER_DISCOUNT_TYPES } = require("../../constants/voucher");
const { PROMO_APPLIES_TO } = require("../../constants/promoCode");
const { LOCATION_KINDS } = require("../../constants/location");
const { SETTLEMENT_STATUS } = require("../../constants/settlement");
const {
  PAYOUT_TYPE,
  PAYOUT_LEG_STATUS,
  PAYOUT_MODE,
} = require("../../constants/payout");
const { OUTLET_TYPES, ROLES, PAYMENT_STATUS } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();
const DAY_MS = 24 * 60 * 60 * 1000;

const MODELS = [
  Transaction,
  VoucherClaim,
  Brand,
  SubBrand,
  Location,
  Customer,
  VoucherVersion,
  Settlement,
  PayoutLeg,
];

let BRAND;
let OUTLET;
let LOCATION;
let BUYER;
let VERSION;
let SETTLEMENT;
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

/**
 * The whole frozen price, as `calculateVoucherPricing` produces it.
 *
 * Spelled out rather than trimmed, because the point of the pricing section is
 * that the brand side finally reads more than four of these — and the one field
 * that must **not** reach them, `platformPromoCost`, is only a real assertion if
 * it is genuinely on the document.
 */
const PRICING = {
  currency: "INR",
  billAmount: 1000,
  offerId: oid(),
  offerTitle: "20% off",
  offerDiscountType: VOUCHER_DISCOUNT_TYPES.PERCENTAGE,
  offerDiscountValue: 20,
  offerMinBillAmount: 100,
  offerMaxDiscountAmount: 250,
  offerDiscount: 200,
  promoCode: "WELCOME50",
  promoCodeId: oid(),
  promoAppliesTo: PROMO_APPLIES_TO.NET_BILL,
  promoBase: 800,
  promoDiscount: 50,
  vendorPromoCost: 25,
  platformPromoCost: 25,
  netBill: 800,
  convenienceFee: 10,
  feeSlabSize: 500,
  feePerSlab: 5,
  feeMaxFee: 50,
  isGstEnabled: false,
  gstPercentage: 0,
  isGstInclusive: true,
  cgst: 0,
  sgst: 0,
  igst: 0,
  gstAmount: 0,
  taxOnTop: 0,
  placeOfSupplyState: "Madhya Pradesh",
  placeOfSupplyStateCode: "23",
  totalPayable: 760,
  amountInPaise: 76000,
  youSaved: 250,
  vendorPayable: 775,
  commissionPercent: 0,
  commissionAmount: 0,
  commissionTax: 0,
  commissionDeduction: 0,
};

let codeSeq = 97_000_000;

const seedWorld = async ({ withSettlement = true } = {}) => {
  const userId = oid();

  BRAND = await Brand.create({
    brandName: "cafe mocha",
    uniqueId: `TDB${Date.now()}${Math.floor(Math.random() * 100000)}`,
    userId,
    merchantId: await generateBrandMerchantId(),
  });

  LOCATION = await Location.create({
    kind: LOCATION_KINDS.SUB_BRAND,
    userId,
    brandId: BRAND._id,
    subBrandId: undefined,
    addressLine1: "12 MG Road",
    addressLine2: "Above Kalyan Jewellers",
    landmark: "Opposite the clock tower",
    city: "Indore",
    district: "Indore",
    state: "Madhya Pradesh",
    country: "India",
    zipcode: "452001",
    formattedAddress: "12 MG Road, Indore, Madhya Pradesh 452001",
    geo: { type: "Point", coordinates: [75.8577, 22.7196] },
  });

  OUTLET = await SubBrand.create({
    userId,
    brandId: BRAND._id,
    locationId: LOCATION._id,
    outletType: OUTLET_TYPES.FRANCHISE,
    uniqueId: `TDO${Date.now()}${Math.floor(Math.random() * 100000)}`,
    storeId: await generateSubBrandStoreId(),
    email: "mgroad@cafemocha.test",
    mobile: "9811111111",
    whatsappNumber: "9811111112",
    description: "The MG Road counter",
    geo: { type: "Point", coordinates: [75.8577, 22.7196] },
  });

  // The address points back at the outlet, the way `createLocation` writes it.
  await Location.updateOne(
    { _id: LOCATION._id },
    { $set: { subBrandId: OUTLET._id } },
  );

  BUYER = await Customer.create({
    userId: oid(),
    uniqueId: "TDC000777",
    fullName: "Asha Menon",
    email: "asha@example.com",
    mobile: "9876543210",
    whatsappNumber: "9876543211",
  });

  VERSION = await VoucherVersion.create({
    voucherId: oid(),
    brandId: BRAND._id,
    createdBy: userId,
    categoryId: oid(),
    subCategoryId: oid(),
    name: "Weekend Special",
    description: "Flat 20% off on the whole bill",
    tags: ["weekend", "dining"],
    versionNumber: 3,
    versionCode: `VCH-${String(codeSeq++).padStart(8, "0")}-V1`,
    startAt: new Date(Date.now() - DAY_MS),
    endAt: new Date(Date.now() + 90 * DAY_MS),
    rejectionReason: "an earlier draft named the wrong outlet",
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

  SETTLEMENT = withSettlement
    ? await Settlement.create({
        settlementNumber: "TD/STL/26-27/000123",
        brandId: BRAND._id,
        periodStart: new Date(Date.now() - 2 * DAY_MS),
        periodEnd: new Date(Date.now() - DAY_MS),
        status: SETTLEMENT_STATUS.PAID,
        grossCollected: 760,
        netPayable: 775,
        transactionCount: 1,
        paidAt: new Date(),
        approvedAt: new Date(Date.now() - 3600_000),
        approvedBy: oid(),
        // ⚠️ Masked and last-four only. The full number is on `Bank` and is
        // deliberately never copied here — see the model.
        bankSnapshot: {
          accountHolderName: "Cafe Mocha LLP",
          maskedAccountNumber: "XXXXXX4521",
          accountLast4Digits: "4521",
          ifscCode: "HDFC0001234",
          bankName: "HDFC Bank",
        },
        idempotencyKey: `STL:${BRAND._id}:${Date.now()}`,
      })
    : null;

  if (SETTLEMENT) {
    // Two legs: a split payout, which is the whole reason a single `payoutUtr`
    // field was never enough.
    await PayoutLeg.create({
      payoutType: PAYOUT_TYPE.SETTLEMENT,
      settlementId: SETTLEMENT._id,
      brandId: BRAND._id,
      legNumber: 1,
      amount: 400,
      status: PAYOUT_LEG_STATUS.PAID,
      utr: "UTR000000000001",
      providerReference: "pout_internal_001",
      mode: PAYOUT_MODE.NEFT,
      initiatedBy: oid(),
      paidAt: new Date(),
      bankSnapshot: { accountLast4Digits: "4521", ifscCode: "HDFC0001234" },
    });
    await PayoutLeg.create({
      payoutType: PAYOUT_TYPE.SETTLEMENT,
      settlementId: SETTLEMENT._id,
      brandId: BRAND._id,
      legNumber: 2,
      amount: 375,
      status: PAYOUT_LEG_STATUS.PAID,
      utr: "UTR000000000002",
      providerReference: "pout_internal_002",
      mode: PAYOUT_MODE.IMPS,
      initiatedBy: oid(),
      paidAt: new Date(),
      bankSnapshot: { accountLast4Digits: "4521", ifscCode: "HDFC0001234" },
    });
  }

  const claimId = oid();

  txn = await Transaction.create({
    purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
    gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
    customerId: BUYER._id,
    brandId: BRAND._id,
    subBrandId: OUTLET._id,
    amount: 760,
    status: PAYMENT_STATUS.CAPTURED,
    verified: true,
    verifiedAt: new Date(Date.now() - 2 * DAY_MS),
    fundsReceivedAt: new Date(Date.now() - DAY_MS),
    paidToVendorAt: SETTLEMENT ? new Date() : undefined,
    settlementId: SETTLEMENT?._id,
    // How the customer actually paid. `vpa` is what a UPI payment gives us; the
    // app behind it is not in the payload.
    paymentMethod: "upi",
    vpa: "asha@okhdfcbank",
    acquirerData: { transaction_id: "ACQ12345678" },
    razorpayOrderId: `order_${Math.random().toString(36).slice(2, 12)}`,
    razorpayPaymentId: `pay_${Math.random().toString(36).slice(2, 12)}`,
    // The three a vendor must never read.
    gatewayFee: 17.94,
    netReceived: 742.06,
    gatewayFeeBearer: GATEWAY_FEE_BEARER.PLATFORM,
    invoiceId: `TD/VCH/26-27/${Math.floor(Math.random() * 1e6)}`,
    documentToken: "a".repeat(64),
    voucher: {
      claimId,
      voucherId: VERSION.voucherId,
      voucherVersionId: VERSION._id,
      versionNumber: VERSION.versionNumber,
      billAmount: 1000,
      offerDiscount: 200,
      netBill: 800,
      convenienceFee: 10,
      vendorPayable: 775,
      platformPromoCost: 25,
      vendorPromoCost: 25,
    },
  });

  claim = await VoucherClaim.create({
    _id: claimId,
    customerId: BUYER._id,
    voucherId: VERSION.voucherId,
    voucherVersionId: VERSION._id,
    versionNumber: VERSION.versionNumber,
    brandId: BRAND._id,
    subBrandId: OUTLET._id,
    billAmount: 1000,
    pricing: PRICING,
    transactionId: txn._id,
    status: VOUCHER_CLAIM_STATUS.REDEEMED,
    claimCode: `TD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    voucherSnapshot: { name: "Weekend Special" },
    brandSnapshot: { name: "cafe mocha" },
    outletSnapshot: { storeId: OUTLET.storeId },
    // The exact offer bought, with its full terms. Frozen, and until now
    // returned to nobody.
    offerSnapshot: {
      title: "20% off",
      minBillAmount: 100,
      discountType: VOUCHER_DISCOUNT_TYPES.PERCENTAGE,
      discountValue: 20,
      maxDiscountAmount: 250,
    },
  });
};

/** Both detail endpoints, which must return the same sections. */
const openBoth = async (actor) => [
  await getClaimTransactionDetail(actor, String(txn._id)),
  await getClaimDetail(actor, { claimId: String(claim._id) }),
];

/**
 * ⚠️ No `createIndexes()` here, unlike its neighbours.
 *
 * The other claim suites build indexes because what they assert **is** an index:
 * the partial uniques that stop two rows which must never coexist from both
 * inserting. Nothing in this file tests a collision — every assertion is about
 * the shape of a read — so nine models' worth of index builds against Atlas buys
 * nothing here.
 *
 * It also cost something real. Nine `createIndexes()` calls, one of them the
 * `VoucherVersionTextIndex`, pushed this `beforeAll` past the 60s hook timeout
 * when the suite ran under load — and a hook timeout fails **every test in the
 * file** with a message that says nothing about indexes.
 */
beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  await clearCollections(...MODELS);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(...MODELS);
  await seedWorld();
});

/* ==========================================================================
 * the outlet
 * ======================================================================== */

describe("outletDetail", () => {
  /**
   * 🔴 The bug this section exists to end.
   *
   * Both services selected `"uniqueId storeId address"` off `SubBrand`, which
   * has no `address` path — the address is a separate `Location` document. An
   * inclusion projection naming a field that does not exist is not an error, so
   * `outlet.address` was absent on every call and nothing anywhere said so.
   */
  it("finally carries the address, which lives on another document", async () => {
    for (const result of await openBoth(vendor(BRAND._id))) {
      expect(result.outletDetail.address.addressLine1).toBe("12 MG Road");
      expect(result.outletDetail.address.city).toBe("Indore");
      expect(result.outletDetail.address.state).toBe("Madhya Pradesh");
      expect(result.outletDetail.address.zipcode).toBe("452001");
      expect(result.outletDetail.address.geo.coordinates).toEqual([
        75.8577, 22.7196,
      ]);
    }
  });

  it("carries the store id and the outlet type", async () => {
    const [payment] = await openBoth(vendor(BRAND._id));

    expect(payment.outletDetail.storeId).toBe(OUTLET.storeId);
    expect(payment.outletDetail.uniqueId).toBe(OUTLET.uniqueId);
    expect(payment.outletDetail.outletType).toBe(OUTLET_TYPES.FRANCHISE);
  });

  /**
   * A counter's phone number is on its storefront. This is not the disclosure
   * `canSeeCustomerPhone` governs, which is about the **buyer**.
   */
  it("carries the outlet's own contact, which is a business detail", async () => {
    const [payment] = await openBoth(vendor(BRAND._id));
    expect(payment.outletDetail.email).toBe("mgroad@cafemocha.test");
    expect(payment.outletDetail.mobile).toBe("9811111111");
  });

  it("keeps the old narrow outlet key exactly as it was", async () => {
    const [payment] = await openBoth(vendor(BRAND._id));

    // Three keys, and `address` is not among them — it never really was.
    expect(Object.keys(payment.outlet).sort()).toEqual([
      "_id",
      "storeId",
      "uniqueId",
    ]);
  });

  it("gives a customer the address but not the operational fields", async () => {
    const [payment] = await openBoth(customer(BUYER._id));

    expect(payment.outletDetail.address.city).toBe("Indore");
    expect(payment.outletDetail.joinedDate).toBeUndefined();
    expect(payment.outletDetail.isActive).toBeUndefined();
  });

  it("returns a null address rather than throwing when none is set", async () => {
    await SubBrand.updateOne({ _id: OUTLET._id }, { $unset: { locationId: 1 } });

    const [payment] = await openBoth(vendor(BRAND._id));
    expect(payment.outletDetail.address).toBeNull();
    expect(payment.outletDetail.storeId).toBe(OUTLET.storeId);
  });
});

/* ==========================================================================
 * the voucher
 * ======================================================================== */

describe("voucher", () => {
  /**
   * 🔴 `offerSnapshot` was named by no projection at all, so *"which offer did
   * this sale use, and on what terms"* had no answer on any surface — while the
   * data sat frozen on the claim the whole time.
   */
  it("names the exact offer that was used, with its terms", async () => {
    for (const result of await openBoth(vendor(BRAND._id))) {
      expect(result.voucher.offer.title).toBe("20% off");
      expect(result.voucher.offer.discountValue).toBe(20);
      expect(result.voucher.offer.maxDiscountAmount).toBe(250);
    }
  });

  it("carries the frozen snapshot and the live version side by side", async () => {
    const [payment] = await openBoth(vendor(BRAND._id));

    // Frozen at claim time.
    expect(payment.voucher.snapshot.name).toBe("Weekend Special");
    // Live, and a different question.
    expect(payment.voucher.version.versionCode).toMatch(/^VCH-\d{8}-V1$/);
    expect(payment.voucher.version.description).toBe(
      "Flat 20% off on the whole bill",
    );
    expect(payment.voucher.version.tags).toEqual(["weekend", "dining"]);
  });

  /**
   * A moderation verdict is written about the vendor, for the people who made
   * it. `pauseReason` is the vendor's own note and is a different field for
   * exactly this reason.
   */
  it("keeps the moderation history to the admin", async () => {
    const [vendorView] = await openBoth(vendor(BRAND._id));
    const [adminView] = await openBoth(admin());

    expect(vendorView.voucher.version.rejectionReason).toBeUndefined();
    expect(adminView.voucher.version.rejectionReason).toBe(
      "an earlier draft named the wrong outlet",
    );
  });

  it("gives a customer the product but not the lifecycle fields", async () => {
    const [payment] = await openBoth(customer(BUYER._id));

    expect(payment.voucher.version.name).toBe("Weekend Special");
    expect(payment.voucher.version.isDeleted).toBeUndefined();
    expect(payment.voucher.version.rejectionReason).toBeUndefined();
  });
});

/* ==========================================================================
 * the pricing
 * ======================================================================== */

describe("pricing", () => {
  /**
   * 🔴 The whole reason this section is gated rather than spread.
   *
   * ⚠️ Mutation note: move `platformPromoCost` from `PRICING_PLATFORM_FIELDS`
   * into `PRICING_VENDOR_FIELDS` and every other assertion in this file still
   * passes. This is the one that fails.
   */
  it("never shows the brand side our margin", async () => {
    for (const actor of [vendor(BRAND._id), subVendor(BRAND._id, OUTLET._id)]) {
      for (const result of await openBoth(actor)) {
        expect(result.pricing.platformPromoCost).toBeUndefined();
        expect(result.pricing.gatewayFee).toBeUndefined();
        expect(result.pricing.netReceived).toBeUndefined();
        expect(result.pricing.vendorGatewayFee).toBeUndefined();
      }
    }
  });

  /**
   * A vendor already reads the commission on their settlement statement. A
   * per-payment view that hid it would contradict the statement built from
   * these same payments — and a deduction they cannot see is one they escalate.
   */
  it("shows the vendor every figure on their own side of the sale", async () => {
    const [payment] = await openBoth(vendor(BRAND._id));
    const p = payment.pricing;

    expect(p.billAmount).toBe(1000);
    expect(p.offerDiscount).toBe(200);
    expect(p.offerTitle).toBe("20% off");
    expect(p.offerMaxDiscountAmount).toBe(250);
    expect(p.promoCode).toBe("WELCOME50");
    expect(p.promoDiscount).toBe(50);
    // Their half of a co-funded promo — and never ours.
    expect(p.vendorPromoCost).toBe(25);
    expect(p.netBill).toBe(800);
    expect(p.commissionDeduction).toBe(0);
    expect(p.vendorPayable).toBe(775);
    expect(p.totalPayable).toBe(760);
    expect(p.youSaved).toBe(250);
  });

  /**
   * The fee is charged to the **customer** and printed on their invoice; it is
   * not a deduction from the vendor and not our margin on their sale. A vendor
   * who can see `totalPayable` but not the fee inside it has a figure that does
   * not reconcile to their own supply.
   *
   * The slab rides along because slabs are admin config with no history at all —
   * "why ₹10?" is answerable only from the copy frozen onto the claim.
   */
  it("shows the vendor the convenience fee and the slab behind it", async () => {
    const [payment] = await openBoth(vendor(BRAND._id));

    expect(payment.pricing.convenienceFee).toBe(10);
    expect(payment.pricing.feeSlabSize).toBe(500);
    expect(payment.pricing.feePerSlab).toBe(5);
    expect(payment.pricing.isGstEnabled).toBe(false);
  });

  it("gives an admin our side of it as well", async () => {
    const [payment] = await openBoth(admin());

    expect(payment.pricing.platformPromoCost).toBe(25);
    expect(payment.pricing.gatewayFee).toBe(17.94);
    expect(payment.pricing.netReceived).toBe(742.06);
    expect(payment.pricing.gatewayFeeBearer).toBe(GATEWAY_FEE_BEARER.PLATFORM);
  });

  it("never shows a customer what the vendor is paid", async () => {
    const [payment] = await openBoth(customer(BUYER._id));

    expect(payment.pricing.convenienceFee).toBe(10);
    expect(payment.pricing.vendorPayable).toBeUndefined();
    expect(payment.pricing.commissionDeduction).toBeUndefined();
    expect(payment.pricing.platformPromoCost).toBeUndefined();
  });

  /**
   * A payment with a refund against it and no sign of one on the page is the
   * most confusing thing this endpoint can show — to all three audiences at
   * once.
   */
  it("says what has come back out, for everyone", async () => {
    await Transaction.updateOne(
      { _id: txn._id },
      { $set: { amountRefunded: 300, refundStatus: "partial" } },
    );

    for (const actor of [vendor(BRAND._id), admin(), customer(BUYER._id)]) {
      const [payment] = await openBoth(actor);
      expect(payment.pricing.amountRefunded).toBe(300);
    }
  });
});

/* ==========================================================================
 * the payment
 * ======================================================================== */

describe("paymentInfo", () => {
  it("carries the references a bank and a customer would quote", async () => {
    const [payment] = await openBoth(vendor(BRAND._id));

    expect(payment.paymentInfo.gatewayPaymentId).toMatch(/^pay_/);
    expect(payment.paymentInfo.gatewayOrderId).toMatch(/^order_/);
    expect(payment.paymentInfo.acquirerTransactionId).toBe("ACQ12345678");
    expect(payment.paymentInfo.invoiceNumber).toMatch(/^TD\/VCH\//);
  });

  /**
   * 🔴 Razorpay does not report which UPI app was used.
   *
   * `@okhdfcbank` is issued through Google Pay by convention, and the payload
   * says only `method: "upi"`. So the handle is published as a handle and no app
   * name is invented from it — a payment screen naming the wrong app is worse
   * than one saying "UPI", because the first is a fact the reader will act on.
   */
  it("publishes the UPI handle and invents no app name from it", async () => {
    const [payment] = await openBoth(vendor(BRAND._id));

    expect(payment.paymentInfo.method.type).toBe("upi");
    expect(payment.paymentInfo.method.vpa).toBe("asha@okhdfcbank");
    expect(payment.paymentInfo.method.vpaHandle).toBe("okhdfcbank");
    // Only ever set when `type` is `wallet` — a PhonePe *wallet* payment is not
    // PhonePe-the-UPI-app, and conflating them is how this field would lie.
    expect(payment.paymentInfo.method.wallet).toBeUndefined();
    expect(payment.paymentInfo.method.app).toBeUndefined();
    expect(payment.paymentInfo.method.upiApp).toBeUndefined();
  });

  it("separates the three moments that are routinely days apart", async () => {
    const [payment] = await openBoth(vendor(BRAND._id));

    expect(payment.paymentInfo.createdAt).toBeInstanceOf(Date);
    // Captured.
    expect(payment.paymentInfo.paidAt).toBeInstanceOf(Date);
    // Settled by Razorpay into our bank — the clock the vendor's payout runs on.
    expect(payment.paymentInfo.fundsReceivedAt).toBeInstanceOf(Date);
  });

  it("names the brand and the outlet the money was paid to", async () => {
    const [payment] = await openBoth(vendor(BRAND._id));

    expect(payment.paymentInfo.paidTo.brandName).toBe("cafe mocha");
    expect(payment.paymentInfo.paidTo.storeId).toBe(OUTLET.storeId);
    expect(String(payment.paymentInfo.paidTo.outletId)).toBe(String(OUTLET._id));
  });

  /**
   * Which of our two Razorpay accounts took the money is plumbing, and the
   * gateway's error codes are staff-facing — a customer is shown a sentence.
   */
  it("keeps our plumbing and the gateway's error codes to the admin", async () => {
    const [vendorView] = await openBoth(vendor(BRAND._id));
    const [adminView] = await openBoth(admin());

    expect(vendorView.paymentInfo.gatewayAccount).toBeUndefined();
    expect(vendorView.paymentInfo.errorCode).toBeUndefined();
    expect(vendorView.paymentInfo.razorpaySettlementId).toBeUndefined();

    expect(adminView.paymentInfo.gatewayAccount).toBe(RAZORPAY_ACCOUNTS.CUSTOMER);
    expect(adminView.paymentInfo.acquirerData.transaction_id).toBe("ACQ12345678");
  });
});

/* ==========================================================================
 * the settlement — ours to the vendor
 * ======================================================================== */

describe("settlement", () => {
  it("names the payout this payment ended up in", async () => {
    for (const result of await openBoth(vendor(BRAND._id))) {
      expect(result.settlement.state).toBe("PAID");
      expect(result.settlement.isSettled).toBe(true);
      expect(result.settlement.record.settlementNumber).toBe(
        "TD/STL/26-27/000123",
      );
      expect(result.settlement.record.status).toBe(SETTLEMENT_STATUS.PAID);
      expect(result.settlement.record.netPayable).toBe(775);
      expect(result.settlement.paidToVendorAt).toBeInstanceOf(Date);
    }
  });

  /**
   * ⚠️ A list, not a field. A large payout can be split across two NEFTs and a
   * bounced one is retried as a new leg — which is exactly why `PayoutLeg`
   * exists instead of a `payoutUtr` column that would have lost the second UTR.
   */
  it("returns every payout leg with its own UTR", async () => {
    const [payment] = await openBoth(vendor(BRAND._id));

    expect(payment.settlement.legs).toHaveLength(2);
    expect(payment.settlement.legs.map((l) => l.utr)).toEqual([
      "UTR000000000001",
      "UTR000000000002",
    ]);
    expect(payment.settlement.legs[0].mode).toBe(PAYOUT_MODE.NEFT);
    expect(payment.settlement.legs[1].amount).toBe(375);
  });

  /**
   * The vendor's own account, masked. 🔴 The full number is not stored on the
   * settlement at all — `bankSnapshot` carries the masked form and the last four
   * and nothing else, by design.
   */
  it("shows the vendor the masked account and the IFSC it was sent to", async () => {
    const [payment] = await openBoth(vendor(BRAND._id));

    expect(payment.settlement.bank.maskedAccountNumber).toBe("XXXXXX4521");
    expect(payment.settlement.bank.accountLast4Digits).toBe("4521");
    expect(payment.settlement.bank.ifscCode).toBe("HDFC0001234");
    expect(payment.settlement.bank.bankName).toBe("HDFC Bank");
    expect(payment.settlement.bank.accountHolderName).toBe("Cafe Mocha LLP");

    // There is no full account number to leak, and none appears.
    expect(payment.settlement.bank.accountNumber).toBeUndefined();
  });

  /**
   * `taintedTransactionIds` names payments under dispute before anybody has
   * decided; `approvedBy` is which admin signed it off. Neither is the vendor's
   * business, and the settlement projection is the one place that decides so.
   */
  it("keeps the internal review state to the admin", async () => {
    const [vendorView] = await openBoth(vendor(BRAND._id));
    const [adminView] = await openBoth(admin());

    expect(vendorView.settlement.record.needsRevalidation).toBeUndefined();
    expect(vendorView.settlement.record.approvedBy).toBeUndefined();
    expect(vendorView.settlement.legs[0].providerReference).toBeUndefined();

    expect(adminView.settlement.record.approvedBy).toBeDefined();
    expect(adminView.settlement.legs[0].providerReference).toBe(
      "pout_internal_001",
    );
  });

  /**
   * The common case for the first day or two of any payment's life. A panel
   * showing blank fields where a payout reference belongs reads as a fault, so
   * this says it in a word.
   */
  it("says so in words when there is no payout yet", async () => {
    await Transaction.updateOne(
      { _id: txn._id },
      { $unset: { settlementId: 1, paidToVendorAt: 1 } },
    );

    for (const result of await openBoth(vendor(BRAND._id))) {
      expect(result.settlement.state).toBe("NOT_SETTLED");
      expect(result.settlement.isSettled).toBe(false);
      expect(result.settlement.record).toBeNull();
      expect(result.settlement.legs).toEqual([]);
    }
  });

  /**
   * A hold keeps a payment out of every future cycle until somebody releases
   * it, and a hold nobody releases does that silently and for ever. "Why was
   * this one not paid?" is answered here.
   */
  it("explains a hold rather than just omitting the payout", async () => {
    await Transaction.updateOne(
      { _id: txn._id },
      {
        $unset: { settlementId: 1, paidToVendorAt: 1 },
        $set: {
          settlementHold: true,
          settlementHoldReason: "Refund requested by the customer",
        },
      },
    );

    const [payment] = await openBoth(vendor(BRAND._id));
    expect(payment.settlement.state).toBe("ON_HOLD");
    expect(payment.settlement.hold.isHeld).toBe(true);
    expect(payment.settlement.hold.reason).toBe(
      "Refund requested by the customer",
    );
  });

  /**
   * 🔴 A customer must not read the vendor's payout at all.
   *
   * ⚠️ This would have leaked by **omission**. `settlementProjection` branches
   * on `ADMIN` and falls through to the vendor shape for everything else — so a
   * `ROLES.CUSTOMER` passed into it comes back with the vendor's projection in
   * full: `netPayable` and `grossCollected` for the brand's whole period, and a
   * `bank` block naming their account holder, masked number and IFSC. Nothing in
   * that function is wrong; it was written for an endpoint only two roles can
   * reach, and this one has three.
   */
  it("gives a customer no payout section at all", async () => {
    for (const result of await openBoth(customer(BUYER._id))) {
      expect(result.settlement).toBeNull();
    }
  });

  /**
   * The same refusal stated as the thing that would actually hurt: the vendor's
   * banking must not appear anywhere in a customer's response.
   */
  it("never puts the vendor's bank details in a customer's response", async () => {
    for (const result of await openBoth(customer(BUYER._id))) {
      const body = JSON.stringify(result);
      expect(body).not.toContain("XXXXXX4521");
      expect(body).not.toContain("HDFC0001234");
      expect(body).not.toContain("Cafe Mocha LLP");
      expect(body).not.toContain("UTR000000000001");
      expect(body).not.toContain("TD/STL/26-27/000123");
    }
  });

  /** What they legitimately ask — "has my refund come back" — they still get. */
  it("still tells a customer what came back out", async () => {
    await Transaction.updateOne(
      { _id: txn._id },
      { $set: { amountRefunded: 300 } },
    );

    const [payment] = await openBoth(customer(BUYER._id));
    expect(payment.pricing.amountRefunded).toBe(300);
  });

  /**
   * 🔴 Two different things are called a settlement on this row, and the wrong
   * one would be a lie about whether the vendor has been paid.
   *
   * `razorpaySettlementId` is Razorpay paying **Trydood**. It must never appear
   * in this section, for anybody.
   */
  it("reports our payout to the vendor, never Razorpay's payout to us", async () => {
    await Transaction.updateOne(
      { _id: txn._id },
      { $set: { razorpaySettlementId: "setl_RAZORPAY_TO_US" } },
    );

    for (const actor of [vendor(BRAND._id), admin()]) {
      const [payment] = await openBoth(actor);
      expect(JSON.stringify(payment.settlement)).not.toContain(
        "setl_RAZORPAY_TO_US",
      );
    }
  });
});

/* ==========================================================================
 * the two endpoints agree
 * ======================================================================== */

describe("both detail endpoints carry the same sections", () => {
  it("returns the same section keys from the payment and the claim page", async () => {
    for (const actor of [vendor(BRAND._id), admin(), customer(BUYER._id)]) {
      const [payment, claimPage] = await openBoth(actor);

      for (const section of [
        "outletDetail",
        "voucher",
        "pricing",
        "paymentInfo",
        "settlement",
      ]) {
        // `settlement` is deliberately `null` for a customer. Asserting the
        // null-ness on both sides is the point: a section withheld on one page
        // and returned on the other is the drift this test exists to catch.
        if (payment[section] === null || claimPage[section] === null) {
          expect(payment[section]).toBeNull();
          expect(claimPage[section]).toBeNull();
          continue;
        }

        expect(Object.keys(payment[section]).sort()).toEqual(
          Object.keys(claimPage[section]).sort(),
        );
      }
    }
  });
});
