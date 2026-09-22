/**
 * The pure half of promo validation — the rules the checkout validators and the
 * two listings all run.
 *
 * Required **by file**, never through `helpers/promoCodes`: that barrel pulls in
 * the reservation helpers, which pull in models, and nothing here needs a
 * database. Keeping it by file is what lets these run in the fast suite.
 */
const {
  evaluateCustomerPromo,
} = require("../../helpers/promoCodes/evaluateCustomerPromo");
const {
  evaluateVendorPromo,
} = require("../../helpers/promoCodes/evaluateVendorPromo");
const {
  buildPromoTerms,
  buildPromoHeadline,
} = require("../../helpers/promoCodes/buildPromoTerms");
const {
  shapePromoForList,
} = require("../../helpers/promoCodes/shapePromoForList");
const {
  PROMO_AUDIENCE,
  PROMO_DISCOUNT_TYPES,
  PROMO_APPLIES_TO,
  PROMO_REJECTION,
} = require("../../constants/promoCode");

const DAY = 24 * 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms);
const ahead = (ms) => new Date(Date.now() + ms);

const customerCode = (overrides = {}) => ({
  _id: "promo-1",
  code: "SAVE50",
  audience: PROMO_AUDIENCE.CUSTOMER,
  description: "Flat 50 off",
  discountType: PROMO_DISCOUNT_TYPES.PERCENT,
  discountPercent: 50,
  isActive: true,
  appliesTo: PROMO_APPLIES_TO.NET_BILL,
  perCustomerUsageLimit: 1,
  ...overrides,
});

const vendorCode = (overrides = {}) => ({
  _id: "promo-v1",
  code: "PLAN20",
  audience: PROMO_AUDIENCE.VENDOR,
  discountType: PROMO_DISCOUNT_TYPES.PERCENT,
  discountPercent: 20,
  isActive: true,
  perBrandUsageLimit: 1,
  ...overrides,
});

// A checkout that passes everything, so each test can break exactly one thing.
const checkout = (promo, overrides = {}) =>
  evaluateCustomerPromo({
    promo,
    voucher: { _id: "v1", categoryId: "c1" },
    brandId: "b1",
    billAmount: 1000,
    netBill: 900,
    convenienceFee: 20,
    config: { allowWhenNoOffer: true },
    offerApplied: true,
    ...overrides,
  });

describe("evaluateCustomerPromo — the gates that need a bill", () => {
  test("the minimum is compared against the raw bill, not the discounted base", () => {
    const promo = customerCode({ minBillAmount: 950 });

    // The customer typed 1000 and the offer took it to 900. The minimum they
    // were shown is about the number they typed — rejecting this would make the
    // threshold depend on which offer happened to apply, which no card can say.
    expect(checkout(promo).ok).toBe(true);

    expect(checkout(promo, { billAmount: 949 })).toMatchObject({
      ok: false,
      reason: PROMO_REJECTION.MIN_BILL_AMOUNT,
    });
  });

  test("a discount is clamped to the base it applies to, never the order", () => {
    const fee = customerCode({
      discountType: PROMO_DISCOUNT_TYPES.FLAT,
      discountAmount: 50,
      appliesTo: PROMO_APPLIES_TO.CONVENIENCE_FEE,
    });

    // ₹50 against a ₹20 fee is worth ₹20. Letting it through whole would eat
    // ₹30 out of the bill, which this code never applied to.
    expect(checkout(fee)).toMatchObject({ ok: true, discount: 20 });
  });

  test("a promo with no offer behind it needs the admin switch", () => {
    const promo = customerCode();

    expect(
      checkout(promo, { offerApplied: false, config: {} }),
    ).toMatchObject({ ok: false, reason: PROMO_REJECTION.NO_OFFER_APPLIED });

    expect(
      checkout(promo, {
        offerApplied: false,
        config: { allowWhenNoOffer: true },
      }).ok,
    ).toBe(true);
  });
});

/**
 * The listing opens with no checkout behind it, and half the gates cannot be
 * answered there. This is the mode that says so — and the reason it is a mode
 * rather than a set of zeros.
 */
describe("evaluateCustomerPromo — hasCheckoutContext: false", () => {
  const contextless = (promo, overrides = {}) =>
    evaluateCustomerPromo({ promo, hasCheckoutContext: false, ...overrides });

  test("a minimum bill does not reject a code nobody has priced yet", () => {
    // With a bill of zero standing in for "no bill", every code carrying a
    // minimum would be listed as unusable — the catalogue would show nothing
    // but rejections.
    expect(contextless(customerCode({ minBillAmount: 500 })).ok).toBe(true);
  });

  test("a scope list does not reject a code with no voucher to check", () => {
    const scoped = customerCode({
      voucherIds: ["other-voucher"],
      brandIds: ["other-brand"],
      categoryIds: ["other-category"],
    });
    expect(contextless(scoped).ok).toBe(true);
  });

  test("the no-offer gate is not applied without a bill", () => {
    // `config` is empty here: `allowWhenNoOffer` is false, which at a real
    // checkout rejects. There is no checkout, so there is nothing to reject.
    expect(contextless(customerCode()).ok).toBe(true);
  });

  test("discount is null, not zero", () => {
    // `0` reads as "worth nothing" and sends the app to a struck-through price.
    // `null` is the honest answer: not priced here.
    expect(contextless(customerCode()).discount).toBeNull();
    expect(contextless(customerCode()).promoBase).toBeNull();
  });

  test("the gates that stand on their own still decide", () => {
    expect(contextless(customerCode({ isActive: false }))).toMatchObject({
      ok: false,
      reason: PROMO_REJECTION.INACTIVE,
    });

    expect(
      contextless(customerCode({ validTill: ago(DAY) })),
    ).toMatchObject({ ok: false, reason: PROMO_REJECTION.EXPIRED });

    expect(
      contextless(customerCode(), { customerUsageCount: 1 }),
    ).toMatchObject({ ok: false, reason: PROMO_REJECTION.CUSTOMER_LIMIT_REACHED });

    expect(
      contextless(customerCode({ firstOrderOnly: true }), {
        priorOrderCount: 2,
      }),
    ).toMatchObject({ ok: false, reason: PROMO_REJECTION.FIRST_ORDER_ONLY });
  });
});

describe("evaluateVendorPromo", () => {
  test("a minimum order value is not applied without a plan", () => {
    const promo = vendorCode({ minOrderValue: 5000 });

    // With a plan, a small one is refused.
    expect(
      evaluateVendorPromo({ promo, taxableValue: 1000, subscription: { _id: "p1" } }),
    ).toMatchObject({ ok: false, reason: PROMO_REJECTION.MIN_ORDER_VALUE });

    // With no plan named there is no price to compare, and a zero base must not
    // stand in for one.
    expect(evaluateVendorPromo({ promo, hasCheckoutContext: false }).ok).toBe(
      true,
    );
  });

  test("plan and action scopes are skipped with no plan, enforced with one", () => {
    const promo = vendorCode({
      subscriptionIds: ["gold"],
      applicableActions: ["RENEW"],
    });

    expect(evaluateVendorPromo({ promo, hasCheckoutContext: false }).ok).toBe(
      true,
    );

    expect(
      evaluateVendorPromo({
        promo,
        subscription: { _id: "silver" },
        action: "RENEW",
        taxableValue: 5000,
      }),
    ).toMatchObject({ ok: false, reason: PROMO_REJECTION.PLAN_NOT_ELIGIBLE });

    expect(
      evaluateVendorPromo({
        promo,
        subscription: { _id: "gold" },
        action: "NEW",
        taxableValue: 5000,
      }),
    ).toMatchObject({ ok: false, reason: PROMO_REJECTION.ACTION_NOT_ELIGIBLE });
  });

  test("the per-brand cap counts what was passed in", () => {
    const promo = vendorCode({ perBrandUsageLimit: 2 });
    const args = { promo, subscription: { _id: "p1" }, taxableValue: 5000 };

    expect(evaluateVendorPromo({ ...args, brandUsageCount: 1 }).ok).toBe(true);
    expect(
      evaluateVendorPromo({ ...args, brandUsageCount: 2 }),
    ).toMatchObject({ ok: false, reason: PROMO_REJECTION.BRAND_LIMIT_REACHED });
  });
});

/**
 * Terms are generated from the code's own fields, and that is the whole point:
 * a term cannot say ₹200 while the rule enforces ₹300.
 */
describe("buildPromoTerms", () => {
  test("every derived term restates a rule the evaluator actually enforces", () => {
    const promo = customerCode({
      minBillAmount: 300,
      maxDiscountAmount: 100,
      perCustomerUsageLimit: 2,
      firstOrderOnly: true,
      validTill: ahead(30 * DAY),
    });

    const terms = buildPromoTerms(promo, {
      audience: PROMO_AUDIENCE.CUSTOMER,
    });

    expect(terms).toEqual(
      expect.arrayContaining([
        "Minimum bill of ₹300.",
        "Maximum discount of ₹100.",
        "Can be used up to 2 times per customer.",
        "Valid on your first order only.",
      ]),
    );

    // And the rule those lines describe is the one that runs.
    expect(checkout(promo, { billAmount: 299 }).reason).toBe(
      PROMO_REJECTION.MIN_BILL_AMOUNT,
    );
    expect(checkout(promo, { netBill: 900 }).discount).toBe(100);
    expect(checkout(promo, { customerUsageCount: 2 }).reason).toBe(
      PROMO_REJECTION.CUSTOMER_LIMIT_REACHED,
    );
  });

  test("a perpetual code claims no end date", () => {
    const terms = buildPromoTerms(customerCode(), {
      audience: PROMO_AUDIENCE.CUSTOMER,
    });
    expect(terms.some((line) => line.startsWith("Valid till"))).toBe(false);
  });

  test("a scope with no resolvable names still says it is restricted", () => {
    // The generic wording, never an empty list. "Valid at ." reads as no
    // restriction at all, which is the one thing a scope term must not do.
    const terms = buildPromoTerms(customerCode({ brandIds: ["b1", "b2"] }), {
      audience: PROMO_AUDIENCE.CUSTOMER,
      scopeNames: { brands: [undefined, undefined] },
    });
    expect(terms).toContain("Valid at selected brands.");
  });

  test("a long scope list is summarised rather than spelled out", () => {
    const names = ["A", "B", "C", "D", "E", "F", "G"];
    const terms = buildPromoTerms(
      customerCode({ brandIds: names.map((_, i) => `b${i}`) }),
      { audience: PROMO_AUDIENCE.CUSTOMER, scopeNames: { brands: names } },
    );
    expect(terms).toContain("Valid at A, B, C, D, E and 2 more.");
  });

  test("the admin's own lines come after the derived ones", () => {
    const terms = buildPromoTerms(
      customerCode({ termsAndConditions: ["Dine-in only."] }),
      { audience: PROMO_AUDIENCE.CUSTOMER },
    );
    expect(terms[terms.length - 1]).toBe("Dine-in only.");
  });

  test("the headline follows the discount rather than being stored", () => {
    expect(buildPromoHeadline(customerCode({ maxDiscountAmount: 100 }))).toBe(
      "50% OFF up to ₹100",
    );
    expect(buildPromoHeadline(customerCode())).toBe("50% OFF");
    expect(
      buildPromoHeadline(
        customerCode({
          discountType: PROMO_DISCOUNT_TYPES.FLAT,
          discountAmount: 150,
        }),
      ),
    ).toBe("₹150 OFF");
  });
});

/**
 * 🔴 The response allow-list. Every field here is one a `...promo` would have
 * published.
 */
describe("shapePromoForList", () => {
  const row = (audience) =>
    shapePromoForList(
      customerCode({
        audience,
        costBearing: { mode: "SHARED", vendorPercent: 40 },
        usedCount: 812,
        totalUsageLimit: 1000,
        isPublic: true,
        isDeleted: false,
        createdBy: "admin-1",
        updatedBy: "admin-2",
      }),
      { audience, isApplicable: true, used: 0 },
    );

  test("who funds the discount never leaves the building", () => {
    // `costBearing` is our margin split with the brand. To a vendor it is what
    // the platform keeps; to a customer it is that made public.
    expect(row(PROMO_AUDIENCE.CUSTOMER)).not.toHaveProperty("costBearing");
    expect(row(PROMO_AUDIENCE.VENDOR)).not.toHaveProperty("costBearing");
  });

  test("the platform's counters are not the caller's business", () => {
    // How many of a code are left, and how fast they are going, describes the
    // campaign — a competitor's question, not a customer's.
    const shaped = row(PROMO_AUDIENCE.CUSTOMER);
    expect(shaped).not.toHaveProperty("usedCount");
    expect(shaped).not.toHaveProperty("totalUsageLimit");
    expect(shaped).not.toHaveProperty("remainingUses");
  });

  test("internal state stays internal", () => {
    const shaped = row(PROMO_AUDIENCE.CUSTOMER);
    for (const field of ["isPublic", "isDeleted", "createdBy", "updatedBy"]) {
      expect(shaped).not.toHaveProperty(field);
    }
  });

  test("the caller's own usage is theirs to see", () => {
    const shaped = shapePromoForList(
      customerCode({ perCustomerUsageLimit: 3 }),
      { audience: PROMO_AUDIENCE.CUSTOMER, used: 1, isApplicable: true },
    );
    expect(shaped.usage).toEqual({
      perCustomerLimit: 3,
      usedByYou: 1,
      usesLeft: 2,
    });
  });

  test("a rejection reason is dropped when the code applies", () => {
    const shaped = shapePromoForList(customerCode(), {
      audience: PROMO_AUDIENCE.CUSTOMER,
      isApplicable: true,
      reason: PROMO_REJECTION.EXPIRED,
    });
    expect(shaped.reason).toBeNull();
  });
});
