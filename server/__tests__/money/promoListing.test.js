const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

/**
 * The claim preview, stubbed so these tests need no voucher fixtures.
 *
 * The listing goes through `buildClaimPreview` on purpose — the promo drawer and
 * the checkout screen have to agree to the paisa — but what is under test here
 * is what the listing does **with** that context, not the pricing itself, which
 * `claimPricing.test.js` already owns. Same stub the claim lifecycle suite uses.
 *
 * Named `mock*` because jest refuses a factory that closes over anything else.
 */
let mockPreview;
jest.mock("../../helpers/vouchers", () => {
  const actual = jest.requireActual("../../helpers/vouchers");
  return { ...actual, buildClaimPreview: (...args) => mockPreview(...args) };
});

const PromoCode = require("../../models/PromoCode");
const PromoCodeUsage = require("../../models/PromoCodeUsage");
const Brand = require("../../models/Brand");
const Subscribed = require("../../models/Subscribed");
const {
  getCustomerPromoCodes,
  getVendorPromoCodes,
  createPromoCode,
} = require("../../services/promoCodes");
const {
  PROMO_AUDIENCE,
  PROMO_DISCOUNT_TYPES,
  PROMO_USAGE_STATUS,
  PROMO_REJECTION,
  PROMO_COST_BEARING_MODE,
} = require("../../constants/promoCode");
const { SUBSCRIBED_STATUS } = require("../../constants/subscription");
const { ROLES } = require("../../constants");
const { generateBrandMerchantId } = require("../../helpers/brands");

const oid = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms);
const ahead = (ms) => new Date(Date.now() + ms);

const CUSTOMER = oid();
const OTHER_CUSTOMER = oid();
const VOUCHER = oid();
const CATEGORY = oid();
const VENDOR_USER = oid();

let BRAND;
let OTHER_BRAND;

const customerActor = (customerId = CUSTOMER) => ({ customerId });
const vendorActor = () => ({
  userId: VENDOR_USER,
  role: ROLES.VENDOR,
  brandId: BRAND._id,
});

/** A listed customer code. Every field a listing decides on is overridable. */
const listedCustomerCode = (overrides = {}) =>
  PromoCode.create({
    code: `CUST${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    description: "Flat off on your bill",
    audience: PROMO_AUDIENCE.CUSTOMER,
    discountType: PROMO_DISCOUNT_TYPES.PERCENT,
    discountPercent: 10,
    isPublic: true,
    ...overrides,
  });

const listedVendorCode = (overrides = {}) =>
  PromoCode.create({
    code: `VEND${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    description: "Off your next plan",
    audience: PROMO_AUDIENCE.VENDOR,
    discountType: PROMO_DISCOUNT_TYPES.PERCENT,
    discountPercent: 10,
    isPublic: true,
    ...overrides,
  });

const codesIn = (result) => result.data.map((row) => row.code);

beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  await clearCollections(PromoCode, PromoCodeUsage, Brand, Subscribed);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(PromoCode, PromoCodeUsage, Brand, Subscribed);

  BRAND = await Brand.create({
    brandName: "listing brand",
    uniqueId: `TDB${Date.now()}${Math.floor(Math.random() * 1000)}`,
    userId: VENDOR_USER,
    merchantId: await generateBrandMerchantId(),
  });
  OTHER_BRAND = await Brand.create({
    brandName: "other brand",
    uniqueId: `TDB${Date.now() + 1}${Math.floor(Math.random() * 1000)}`,
    userId: oid(),
    merchantId: await generateBrandMerchantId(),
  });

  mockPreview = jest.fn(async () => ({
    pricing: { billAmount: 1000, netBill: 900, convenienceFee: 20 },
    offerApplied: true,
    _internal: {
      voucher: { _id: VOUCHER, categoryId: CATEGORY },
      brandId: BRAND._id,
    },
  }));
});

/**
 * 🔴 The listing is an opt-in, and the default has to be "hidden".
 *
 * A schema default applies on **write** only, so every code that existed before
 * `isPublic` did carries no value at all. Reading absent as "listed" would have
 * published every targeted campaign on the platform the moment this shipped —
 * the influencer code, the win-back code, the one code mailed to one customer.
 */
describe("only codes an admin opted in are listed", () => {
  test("a code with isPublic false or missing never appears", async () => {
    const shown = await listedCustomerCode({ code: "SHOWN1" });
    await listedCustomerCode({ code: "HIDDEN1", isPublic: false });

    // The shape of a code written before the field existed.
    const legacy = await listedCustomerCode({ code: "LEGACY1" });
    await PromoCode.collection.updateOne(
      { _id: legacy._id },
      { $unset: { isPublic: "" } },
    );

    const result = await getCustomerPromoCodes(customerActor(), {});

    expect(codesIn(result)).toEqual([shown.code]);
  });

  test("hiding a code does not stop it being redeemed", async () => {
    // `isPublic` decides whether we hand a code out, never whether it works.
    // A targeted campaign is exactly a code that is redeemable and unlisted, so
    // the checkout lookup must not filter on it.
    const {
      validateCustomerPromoCode,
    } = require("../../helpers/promoCodes");

    await listedCustomerCode({
      code: "SECRET1",
      isPublic: false,
      discountType: PROMO_DISCOUNT_TYPES.FLAT,
      discountAmount: 50,
    });

    const verdict = await validateCustomerPromoCode({
      code: "SECRET1",
      customerId: CUSTOMER,
      voucher: { _id: VOUCHER, categoryId: CATEGORY },
      brandId: BRAND._id,
      billAmount: 1000,
      netBill: 900,
      convenienceFee: 20,
      config: { isEnabled: true, allowWhenNoOffer: true },
      offerApplied: true,
    });

    expect(verdict).toMatchObject({ ok: true, discount: 50 });
  });
});

describe("the two audiences never see each other's codes", () => {
  test("a vendor code is not in the customer listing, and the reverse", async () => {
    const forCustomers = await listedCustomerCode({ code: "CUSTONLY" });
    const forVendors = await listedVendorCode({ code: "VENDONLY" });

    const customerList = await getCustomerPromoCodes(customerActor(), {});
    const vendorList = await getVendorPromoCodes(vendorActor(), {});

    expect(codesIn(customerList)).toEqual([forCustomers.code]);
    expect(codesIn(vendorList)).toEqual([forVendors.code]);
  });

  test("a code written before `audience` existed is listed as a vendor code", async () => {
    // `{ audience: VENDOR }` would match none of them. The filter has to be
    // `$ne: CUSTOMER`, which is what `buildAudienceFilter` is for.
    const legacy = await listedVendorCode({ code: "LEGACYAUD" });
    await PromoCode.collection.updateOne(
      { _id: legacy._id },
      { $unset: { audience: "" } },
    );

    const vendorList = await getVendorPromoCodes(vendorActor(), {});
    expect(codesIn(vendorList)).toEqual([legacy.code]);

    const customerList = await getCustomerPromoCodes(customerActor(), {});
    expect(codesIn(customerList)).toEqual([]);
  });
});

describe("what counts as on offer right now", () => {
  test("a perpetual code is listed; an expired or scheduled one is not", async () => {
    /**
     * 🔴 The regression this pins. A code meant to run indefinitely has **no**
     * `validTill` — the field is absent, not null. In a query filter
     * `{ validTill: null }` matches a missing field too, which is what makes
     * this work; the same comparison inside an aggregation *expression* does
     * not, and that difference already shipped once as "every perpetual code is
     * expired".
     */
    const perpetual = await listedCustomerCode({ code: "FOREVER" });
    await listedCustomerCode({ code: "ENDED", validTill: ago(DAY) });
    await listedCustomerCode({ code: "LATER", validFrom: ahead(DAY) });
    const running = await listedCustomerCode({
      code: "RUNNING",
      validFrom: ago(DAY),
      validTill: ahead(DAY),
    });

    const codes = codesIn(await getCustomerPromoCodes(customerActor(), {}));
    expect(codes.sort()).toEqual([perpetual.code, running.code].sort());
  });

  test("a code that has been fully redeemed is dropped, not listed as unusable", async () => {
    // Nothing a customer can do about it, and a drawer full of dead campaigns
    // buries the ones that work.
    await listedCustomerCode({
      code: "BURNTOUT",
      totalUsageLimit: 5,
      usedCount: 5,
    });
    const alive = await listedCustomerCode({
      code: "ALIVE",
      totalUsageLimit: 5,
      usedCount: 4,
    });
    const uncapped = await listedCustomerCode({ code: "UNCAPPED" });

    const codes = codesIn(await getCustomerPromoCodes(customerActor(), {}));
    expect(codes.sort()).toEqual([alive.code, uncapped.code].sort());
  });

  test("an inactive code is not listed", async () => {
    await listedCustomerCode({ code: "SWITCHEDOFF", isActive: false });
    const result = await getCustomerPromoCodes(customerActor(), {});
    expect(result.data).toEqual([]);
    // An empty list, not a 404 — the question was fine and the answer is none.
    expect(result.total).toBe(0);
  });
});

/**
 * 🔴 The response is an allow-list, and this is the test that keeps it one.
 * A `...promo` anywhere in the shaping would publish all of these.
 */
describe("what a listed row may not carry", () => {
  test("costBearing, the platform counters and internal state are absent", async () => {
    await listedCustomerCode({
      code: "LEAKCHECK",
      brandIds: [BRAND._id],
      costBearing: {
        mode: PROMO_COST_BEARING_MODE.SHARED,
        vendorPercent: 40,
      },
      totalUsageLimit: 1000,
      usedCount: 812,
      createdBy: oid(),
    });

    const [row] = (await getCustomerPromoCodes(customerActor(), {})).data;

    for (const field of [
      "costBearing",
      "usedCount",
      "totalUsageLimit",
      "isPublic",
      "isDeleted",
      "createdBy",
      "updatedBy",
    ]) {
      expect(row).not.toHaveProperty(field);
    }
  });
});

describe("what the caller has already used", () => {
  test("a spent code is shown with the reason and no uses left", async () => {
    const promo = await listedCustomerCode({
      code: "ONCEONLY",
      perCustomerUsageLimit: 1,
    });
    await PromoCodeUsage.create({
      promoCodeId: promo._id,
      code: promo.code,
      audience: PROMO_AUDIENCE.CUSTOMER,
      customerId: CUSTOMER,
      status: PROMO_USAGE_STATUS.CONSUMED,
    });

    const [row] = (await getCustomerPromoCodes(customerActor(), {})).data;

    expect(row).toMatchObject({
      isApplicable: false,
      reason: PROMO_REJECTION.CUSTOMER_LIMIT_REACHED,
      usage: { perCustomerLimit: 1, usedByYou: 1, usesLeft: 0 },
    });
  });

  test("an open checkout counts, so a single-use code cannot be spent twice", async () => {
    // RESERVED, not CONSUMED. Counting only the settled ones would let a
    // customer hold two open checkouts against the same single-use code.
    const promo = await listedCustomerCode({ code: "RESERVED1" });
    await PromoCodeUsage.create({
      promoCodeId: promo._id,
      code: promo.code,
      audience: PROMO_AUDIENCE.CUSTOMER,
      customerId: CUSTOMER,
      status: PROMO_USAGE_STATUS.RESERVED,
    });

    const [row] = (await getCustomerPromoCodes(customerActor(), {})).data;
    expect(row.isApplicable).toBe(false);
  });

  test("another customer's usage is not this customer's", async () => {
    const promo = await listedCustomerCode({ code: "SHAREDCODE" });
    await PromoCodeUsage.create({
      promoCodeId: promo._id,
      code: promo.code,
      audience: PROMO_AUDIENCE.CUSTOMER,
      customerId: OTHER_CUSTOMER,
      status: PROMO_USAGE_STATUS.CONSUMED,
    });

    const [row] = (await getCustomerPromoCodes(customerActor(), {})).data;
    expect(row).toMatchObject({
      isApplicable: true,
      usage: { usedByYou: 0, usesLeft: 1 },
    });
  });

  test("a vendor claim on the same code is not counted against a customer", async () => {
    // Both audiences share this collection, so every count is scoped by it.
    const promo = await listedCustomerCode({ code: "CROSSAUD" });
    await PromoCodeUsage.create({
      promoCodeId: promo._id,
      code: promo.code,
      audience: PROMO_AUDIENCE.VENDOR,
      brandId: BRAND._id,
      status: PROMO_USAGE_STATUS.CONSUMED,
    });

    const [row] = (await getCustomerPromoCodes(customerActor(), {})).data;
    expect(row.isApplicable).toBe(true);
  });
});

describe("with a checkout named, and without one", () => {
  const withBill = {
    voucherId: VOUCHER,
    outletId: oid(),
    billAmount: 1000,
  };

  test("a catalogue prices nothing and rejects nothing it cannot judge", async () => {
    // A minimum bill and a brand scope both need a checkout. Answering them
    // with zeros would list every such code as unusable.
    await listedCustomerCode({
      code: "NEEDSBILL",
      minBillAmount: 5000,
      brandIds: [OTHER_BRAND._id],
    });

    const result = await getCustomerPromoCodes(customerActor(), {});
    const [row] = result.data;

    expect(result.context).toBeNull();
    expect(row).toMatchObject({ isApplicable: true, savings: null });
    expect(mockPreview).not.toHaveBeenCalled();
  });

  test("a named checkout prices each code and applies the scope gates", async () => {
    await listedCustomerCode({
      code: "TOOSMALL",
      minBillAmount: 5000,
    });
    await listedCustomerCode({
      code: "WRONGBRAND",
      brandIds: [OTHER_BRAND._id],
    });
    await listedCustomerCode({
      code: "TENOFF",
      discountPercent: 10,
    });

    const result = await getCustomerPromoCodes(customerActor(), withBill);
    const byCode = Object.fromEntries(
      result.data.map((row) => [row.code, row]),
    );

    // 10% of the net bill the preview reported, not of the raw bill.
    expect(byCode.TENOFF).toMatchObject({
      isApplicable: true,
      savings: { discount: 90, base: 900 },
    });
    expect(byCode.TOOSMALL).toMatchObject({
      isApplicable: false,
      reason: PROMO_REJECTION.MIN_BILL_AMOUNT,
      savings: null,
    });
    expect(byCode.WRONGBRAND).toMatchObject({
      isApplicable: false,
      reason: PROMO_REJECTION.BRAND_NOT_ELIGIBLE,
    });

    // The figures the drawer priced against are the ones the checkout screen
    // showed — same builder, one call.
    expect(result.context).toMatchObject({ netBill: 900, billAmount: 1000 });
    expect(mockPreview).toHaveBeenCalledTimes(1);
  });

  test("usable codes come first, biggest saving first", async () => {
    await listedCustomerCode({ code: "SMALL", discountPercent: 5 });
    await listedCustomerCode({ code: "BIG", discountPercent: 20 });
    await listedCustomerCode({ code: "BLOCKED", minBillAmount: 9000 });

    const result = await getCustomerPromoCodes(customerActor(), withBill);
    expect(codesIn(result)).toEqual(["BIG", "SMALL", "BLOCKED"]);
  });
});

describe("the vendor listing", () => {
  test("a brand's own claims are counted, another brand's are not", async () => {
    const promo = await listedVendorCode({
      code: "ONCEPERBRAND",
      perBrandUsageLimit: 1,
    });
    await PromoCodeUsage.create({
      promoCodeId: promo._id,
      code: promo.code,
      audience: PROMO_AUDIENCE.VENDOR,
      brandId: OTHER_BRAND._id,
      status: PROMO_USAGE_STATUS.CONSUMED,
    });

    let [row] = (await getVendorPromoCodes(vendorActor(), {})).data;
    expect(row).toMatchObject({
      isApplicable: true,
      usage: { perBrandLimit: 1, usedByYourBrand: 0, usesLeft: 1 },
    });

    await PromoCodeUsage.create({
      promoCodeId: promo._id,
      code: promo.code,
      audience: PROMO_AUDIENCE.VENDOR,
      brandId: BRAND._id,
      status: PROMO_USAGE_STATUS.CONSUMED,
    });

    [row] = (await getVendorPromoCodes(vendorActor(), {})).data;
    expect(row).toMatchObject({
      isApplicable: false,
      reason: PROMO_REJECTION.BRAND_LIMIT_REACHED,
      usage: { usedByYourBrand: 1, usesLeft: 0 },
    });
  });

  test("a first-purchase-only code is blocked once the brand has had a plan", async () => {
    await listedVendorCode({ code: "FIRSTONLY", firstTimeOnly: true });

    let [row] = (await getVendorPromoCodes(vendorActor(), {})).data;
    expect(row.isApplicable).toBe(true);

    await Subscribed.create({
      brandId: BRAND._id,
      subscriptionId: oid(),
      status: SUBSCRIBED_STATUS.ACTIVE,
      startDate: ago(DAY),
      endDate: ahead(DAY),
    });

    [row] = (await getVendorPromoCodes(vendorActor(), {})).data;
    expect(row).toMatchObject({
      isApplicable: false,
      reason: PROMO_REJECTION.FIRST_TIME_ONLY,
    });
  });

  test("a vendor cannot read another brand's listing", async () => {
    await listedVendorCode({ code: "NOTYOURS" });

    await expect(
      getVendorPromoCodes(vendorActor(), { brandId: OTHER_BRAND._id }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("publishing a code", () => {
  test("a listed code must say what the offer is", async () => {
    // The headline and the terms are derived, but nothing derives the offer
    // itself — without a description the card is a code and a number with no
    // reason to tap it, and nothing anywhere would report that.
    await expect(
      createPromoCode(oid(), {
        code: "NODESC",
        audience: PROMO_AUDIENCE.CUSTOMER,
        discountType: PROMO_DISCOUNT_TYPES.PERCENT,
        discountPercent: 10,
        isPublic: true,
      }),
    ).rejects.toMatchObject({ statusCode: 422 });

    const created = await createPromoCode(oid(), {
      code: "HASDESC",
      audience: PROMO_AUDIENCE.CUSTOMER,
      discountType: PROMO_DISCOUNT_TYPES.PERCENT,
      discountPercent: 10,
      isPublic: true,
      description: "10% off your bill",
    });
    expect(created.isPublic).toBe(true);
  });

  test("a hidden code needs no description", async () => {
    const created = await createPromoCode(oid(), {
      code: "QUIETONE",
      audience: PROMO_AUDIENCE.CUSTOMER,
      discountType: PROMO_DISCOUNT_TYPES.PERCENT,
      discountPercent: 10,
    });
    expect(created.isPublic).toBe(false);
  });
});
