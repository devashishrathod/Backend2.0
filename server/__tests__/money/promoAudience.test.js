const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const PromoCode = require("../../models/PromoCode");
const PromoCodeUsage = require("../../models/PromoCodeUsage");
const {
  validatePromoCode,
  assertPromoWindowAndCaps,
  buildAudienceFilter,
} = require("../../helpers/promoCodes");
const {
  PROMO_AUDIENCE,
  PROMO_DISCOUNT_TYPES,
  PROMO_REJECTION,
} = require("../../constants/promoCode");

const oid = () => new mongoose.Types.ObjectId();

const checkout = (code, overrides = {}) =>
  validatePromoCode({
    code,
    brand: { _id: oid() },
    subscription: { _id: oid() },
    action: "NEW",
    taxableValue: 5000,
    isEnabled: true,
    ...overrides,
  });

/** Strip `audience` the way a document written before the field existed has it. */
const makeLegacy = async (id) => {
  await PromoCode.collection.updateOne(
    { _id: id },
    { $unset: { audience: "" } },
  );
};

beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  await clearCollections(PromoCode, PromoCodeUsage);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(PromoCode, PromoCodeUsage);
});

describe("codes written before `audience` existed keep working", () => {
  /**
   * Test 7 — §5.4.
   *
   * A Mongoose default applies on **write**, never to documents already stored.
   * Every promo code created before `audience` was added therefore has no value
   * at all, and `{ audience: "VENDOR" }` matches none of them.
   *
   * Scoping the vendor lookup with `$eq: VENDOR` would have silently killed
   * every live promo code on the platform — no error, no log, just codes that
   * stopped working. The lookup is `$ne: CUSTOMER` for exactly this reason, and
   * this test is what stops someone "tidying" it into an equality check.
   */
  it("a legacy code with no audience field still validates at vendor checkout", async () => {
    const promo = await PromoCode.create({
      code: "LEGACY20",
      discountType: PROMO_DISCOUNT_TYPES.PERCENT,
      discountPercent: 20,
    });
    await makeLegacy(promo._id);

    // Proves the fixture is genuinely legacy, not merely defaulted.
    const raw = await PromoCode.collection.findOne({ _id: promo._id });
    expect("audience" in raw).toBe(false);

    const verdict = await checkout("LEGACY20");
    expect(verdict.ok).toBe(true);
    expect(verdict.discount).toBe(1000);
  });

  it("would have been invisible under an equality filter", async () => {
    const promo = await PromoCode.create({
      code: "LEGACY10",
      discountType: PROMO_DISCOUNT_TYPES.FLAT,
      discountAmount: 100,
    });
    await makeLegacy(promo._id);

    // The filter the code actually uses.
    expect(
      await PromoCode.countDocuments(buildAudienceFilter(PROMO_AUDIENCE.VENDOR)),
    ).toBe(1);
    // The filter it must never become.
    expect(
      await PromoCode.countDocuments({ audience: PROMO_AUDIENCE.VENDOR }),
    ).toBe(0);
  });

  it("still excludes a customer code from the vendor filter", async () => {
    await PromoCode.create({
      code: "CUSTONLY",
      discountType: PROMO_DISCOUNT_TYPES.FLAT,
      discountAmount: 50,
      audience: PROMO_AUDIENCE.CUSTOMER,
    });

    expect(
      await PromoCode.countDocuments(buildAudienceFilter(PROMO_AUDIENCE.VENDOR)),
    ).toBe(0);
    expect(
      await PromoCode.countDocuments(buildAudienceFilter(PROMO_AUDIENCE.CUSTOMER)),
    ).toBe(1);
  });
});

describe("the two checkouts cannot see each other's codes", () => {
  /**
   * Test 8 — §7 case 18.
   *
   * A customer voucher code offered at subscription checkout must be refused —
   * it discounts a different thing entirely.
   *
   * The refusal is worded **identically** to a code that does not exist. Saying
   * "this code is not for you" confirms it exists, which turns the endpoint into
   * an oracle for enumerating live campaigns.
   */
  it("refuses a customer code at vendor checkout", async () => {
    await PromoCode.create({
      code: "PIZZA50",
      discountType: PROMO_DISCOUNT_TYPES.FLAT,
      discountAmount: 50,
      audience: PROMO_AUDIENCE.CUSTOMER,
    });

    const verdict = await checkout("PIZZA50");
    expect(verdict.ok).toBe(false);
  });

  it("gives an answer indistinguishable from a code that does not exist", async () => {
    await PromoCode.create({
      code: "REALCODE",
      discountType: PROMO_DISCOUNT_TYPES.FLAT,
      discountAmount: 50,
      audience: PROMO_AUDIENCE.CUSTOMER,
    });

    const existing = await checkout("REALCODE");
    const invented = await checkout("NOSUCHCODEATALL");

    expect(existing.reason).toBe(PROMO_REJECTION.NOT_FOUND);
    // Byte-identical. Anything else leaks which codes are live.
    expect(existing.reason).toBe(invented.reason);
    expect(existing.promoCode).toBeUndefined();
  });
});

describe("the per-brand cap counts the ledger, not the counter", () => {
  /**
   * `usedCount` is a fast approximation kept for the platform-wide cap. The
   * per-brand cap counts RESERVED + CONSUMED rows instead, so a vendor cannot
   * hold two open checkouts against a one-per-brand code and pay for both.
   *
   * Scoped by audience: counting a customer's claims against a brand's limit
   * would be nonsense, and the two audiences share this collection.
   */
  it("counts a merely RESERVED row against the brand's limit", async () => {
    const promo = await PromoCode.create({
      code: "ONEPERBRAND",
      discountType: PROMO_DISCOUNT_TYPES.FLAT,
      discountAmount: 100,
      perBrandUsageLimit: 1,
    });
    const brandId = oid();

    await PromoCodeUsage.create({
      promoCodeId: promo._id,
      code: promo.code,
      audience: PROMO_AUDIENCE.VENDOR,
      brandId,
      transactionId: oid(),
      status: "RESERVED",
      discountAmount: 100,
    });

    const verdict = await checkout("ONEPERBRAND", { brand: { _id: brandId } });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe(PROMO_REJECTION.BRAND_LIMIT_REACHED);
  });

  it("does not count a customer claim against a brand's limit", async () => {
    const promo = await PromoCode.create({
      code: "SHAREDCODE",
      discountType: PROMO_DISCOUNT_TYPES.FLAT,
      discountAmount: 100,
      perBrandUsageLimit: 1,
    });
    const brandId = oid();

    // A customer-audience row that happens to carry the same brand.
    await PromoCodeUsage.create({
      promoCodeId: promo._id,
      code: promo.code,
      audience: PROMO_AUDIENCE.CUSTOMER,
      brandId,
      customerId: oid(),
      transactionId: oid(),
      status: "CONSUMED",
      discountAmount: 100,
    });

    const verdict = await checkout("SHAREDCODE", { brand: { _id: brandId } });
    expect(verdict.ok).toBe(true);
  });
});

describe("what a code is worth is decided in one place", () => {
  /**
   * The window, the platform cap and the arithmetic are shared by both audience
   * validators (`assertPromoWindowAndCaps`), so the two checkouts can never
   * disagree on the value of a code. A discount capped differently on one side
   * than the other is a pricing bug that stays invisible until someone compares
   * two invoices.
   */
  const promo = (overrides) => ({
    isActive: true,
    discountType: PROMO_DISCOUNT_TYPES.PERCENT,
    discountPercent: 20,
    usedCount: 0,
    ...overrides,
  });

  it("caps a percentage at maxDiscountAmount", () => {
    const verdict = assertPromoWindowAndCaps({
      promo: promo({ maxDiscountAmount: 1000 }),
      base: 10000,
    });
    // 20% of 10,000 is 2,000; the cap bites.
    expect(verdict.discount).toBe(1000);
  });

  /**
   * Test 9 — §4.1.
   *
   * The clamp to the base is the one that matters on the customer side. A ₹50
   * code applied to a ₹10 convenience fee is worth ₹10 — letting it exceed the
   * base would eat into something it was never meant to discount, and could
   * drive the amount payable to zero or below.
   */
  it("clamps the discount to the base it applies to", () => {
    const verdict = assertPromoWindowAndCaps({
      promo: promo({ discountType: PROMO_DISCOUNT_TYPES.FLAT, discountAmount: 50 }),
      base: 10,
    });
    expect(verdict.discount).toBe(10);
  });

  it("never returns a negative discount", () => {
    const verdict = assertPromoWindowAndCaps({
      promo: promo({ discountType: PROMO_DISCOUNT_TYPES.FLAT, discountAmount: 50 }),
      base: 0,
    });
    expect(verdict.discount).toBe(0);
  });

  it("refuses a code that has run out platform-wide", () => {
    const verdict = assertPromoWindowAndCaps({
      promo: promo({ totalUsageLimit: 100, usedCount: 100 }),
      base: 5000,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe(PROMO_REJECTION.TOTAL_LIMIT_REACHED);
  });

  it("refuses a code outside its window, in both directions", () => {
    const future = assertPromoWindowAndCaps({
      promo: promo({ validFrom: new Date(Date.now() + 86400000) }),
      base: 5000,
    });
    expect(future.reason).toBe(PROMO_REJECTION.NOT_STARTED);

    const past = assertPromoWindowAndCaps({
      promo: promo({ validTill: new Date(Date.now() - 86400000) }),
      base: 5000,
    });
    expect(past.reason).toBe(PROMO_REJECTION.EXPIRED);
  });
});
