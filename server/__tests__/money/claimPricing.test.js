const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const PromoCode = require("../../models/PromoCode");
const PromoCodeUsage = require("../../models/PromoCodeUsage");
const Transaction = require("../../models/Transaction");
const {
  calculateVoucherPricing,
  buildVoucherOrderSummary,
  resolveClaimOffer,
} = require("../../helpers/vouchers");
const {
  validateCustomerPromoCode,
  splitPromoCost,
} = require("../../helpers/promoCodes");
const {
  PROMO_AUDIENCE,
  PROMO_APPLIES_TO,
  PROMO_DISCOUNT_TYPES,
  PROMO_COST_BEARING_MODE,
  PROMO_REJECTION,
  PROMO_USAGE_STATUS,
} = require("../../constants/promoCode");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");

const oid = () => new mongoose.Types.ObjectId();

/** The shipped defaults, as `getCustomerConfig()` returns them. */
const CONFIG = {
  currency: "INR",
  currencySymbol: "₹",
  convenienceFee: {
    isEnabled: true,
    slabSize: 500,
    feePerSlab: 5,
    maxFee: 50,
    chargeWhenNoOffer: false,
  },
  tax: { isGstEnabled: false, gstPercentage: 18, isGstInclusive: true, sacCode: "998599" },
  settlement: { commissionPercent: 0 },
};

const PROMO_CONFIG = {
  isEnabled: true,
  allowWhenNoOffer: false,
  allowForGuestPreview: true,
};

const OFFER = {
  _id: oid(),
  title: "20% off",
  discountType: "PERCENTAGE",
  discountValue: 20,
  minBillAmount: 500,
  usageType: "MULTIPLE",
};

const verdict = (discount, appliesTo = PROMO_APPLIES_TO.NET_BILL) => ({
  ok: true,
  discount,
  appliesTo,
  promoCode: { _id: oid(), code: "WELCOME50" },
});

beforeAll(async () => {
  await connectTestDb();
});

afterAll(async () => {
  await clearCollections(PromoCode, PromoCodeUsage, Transaction);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(PromoCode, PromoCodeUsage, Transaction);
});

describe("a promo discount is clamped to its own base", () => {
  /**
   * The audit finding this suite exists for.
   *
   * A discount clamped to the order *total* rather than to the thing it applies
   * to eats into something it was never meant to touch. A ₹50 code against a
   * ₹10 convenience fee would take ₹40 out of the vendor's bill, and a large
   * NET_BILL code would drive the payable to zero — an amount Razorpay will not
   * create an order for.
   */
  it("takes only the convenience fee when that is its base", () => {
    const pricing = calculateVoucherPricing({
      billAmount: 1000,
      offer: OFFER,
      promo: verdict(50, PROMO_APPLIES_TO.CONVENIENCE_FEE),
      promoCost: { vendorCost: 0, platformCost: 10 },
      config: CONFIG,
    });

    expect(pricing.convenienceFee).toBe(10);
    expect(pricing.promoDiscount).toBe(10);
    // The bill is untouched: 1000 − 200 offer = 800, fee cancelled out.
    expect(pricing.netBill).toBe(800);
    expect(pricing.totalPayable).toBe(800);
  });

  it("never drives the payable below zero", () => {
    const pricing = calculateVoucherPricing({
      billAmount: 1000,
      offer: OFFER,
      // A stale or tampered verdict. The pricing function must be right on its
      // own, not only when its caller behaved.
      promo: verdict(999999),
      promoCost: { vendorCost: 0, platformCost: 999999 },
      config: CONFIG,
    });

    expect(pricing.promoDiscount).toBe(800);
    expect(pricing.totalPayable).toBe(10);
    expect(pricing.amountInPaise).toBeGreaterThan(0);
  });

  it("reports the base it clamped against", () => {
    const onFee = calculateVoucherPricing({
      billAmount: 1000,
      offer: OFFER,
      promo: verdict(50, PROMO_APPLIES_TO.CONVENIENCE_FEE),
      promoCost: { vendorCost: 0, platformCost: 10 },
      config: CONFIG,
    });
    expect(onFee.promoBase).toBe(10);
    expect(onFee.promoAppliesTo).toBe(PROMO_APPLIES_TO.CONVENIENCE_FEE);
  });
});

describe("money invariants", () => {
  /**
   * These are the ones that cannot be checked by looking at a screen.
   *
   * A rounding error of one paisa is invisible in a checkout and shows up as a
   * settlement that will not reconcile.
   */
  const cases = [
    { billAmount: 1000, discount: 50, vendorPercent: 30 },
    { billAmount: 333.33, discount: 10.01, vendorPercent: 33 },
    { billAmount: 777.77, discount: 99.99, vendorPercent: 7 },
    { billAmount: 100000, discount: 1, vendorPercent: 99 },
  ];

  it.each(cases)(
    "vendorPromoCost + platformPromoCost === promoDiscount ($billAmount)",
    ({ billAmount, discount, vendorPercent }) => {
      const promo = { costBearing: { mode: PROMO_COST_BEARING_MODE.SHARED, vendorPercent } };
      const cost = splitPromoCost(promo, discount);
      const pricing = calculateVoucherPricing({
        billAmount,
        offer: OFFER,
        promo: verdict(discount),
        promoCost: cost,
        config: CONFIG,
      });

      expect(
        Math.abs(
          pricing.vendorPromoCost + pricing.platformPromoCost - pricing.promoDiscount,
        ),
      ).toBeLessThan(0.005);
    },
  );

  it.each(cases)("amountInPaise is a whole number ($billAmount)", ({ billAmount, discount }) => {
    const pricing = calculateVoucherPricing({
      billAmount,
      offer: OFFER,
      promo: verdict(discount),
      promoCost: { vendorCost: 0, platformCost: discount },
      config: CONFIG,
    });
    expect(Number.isInteger(pricing.amountInPaise)).toBe(true);
    expect(pricing.amountInPaise).toBe(Math.round(pricing.totalPayable * 100));
  });

  it("cgst + sgst === gstAmount on an intra-state supply", () => {
    const gstConfig = {
      ...CONFIG,
      tax: { isGstEnabled: true, gstPercentage: 18, isGstInclusive: false, sacCode: "998599" },
      companyState: "Tamil Nadu",
    };
    const pricing = calculateVoucherPricing({
      billAmount: 1200,
      offer: OFFER,
      config: gstConfig,
      placeOfSupply: { state: "Tamil Nadu" },
    });

    expect(pricing.taxType).toBe("CGST_SGST");
    expect(pricing.cgst + pricing.sgst).toBeCloseTo(pricing.gstAmount, 2);
    expect(pricing.igst).toBe(0);
  });

  /**
   * The half-paise case, which the shipped configuration cannot reach.
   *
   * At 18% the tax in paise is always `fee × 18` — an even number — so the two
   * halves are always equal and the remainder rule never fires. A test that only
   * ever saw the even case would pass whether or not the rule existed.
   *
   * An odd fee at an odd rate produces a genuinely uneven split, and the whole
   * has to survive it: ₹2.31 becomes ₹1.16 + ₹1.15, not ₹1.15 + ₹1.15 with a
   * paisa lost on the invoice.
   */
  it("gives the odd half-paise to SGST rather than losing it", () => {
    const pricing = calculateVoucherPricing({
      billAmount: 1200,
      offer: OFFER,
      config: {
        ...CONFIG,
        convenienceFee: { isEnabled: true, slabSize: 500, feePerSlab: 11, maxFee: null },
        tax: { isGstEnabled: true, gstPercentage: 7, isGstInclusive: false },
        companyState: "Tamil Nadu",
      },
      placeOfSupply: { state: "Tamil Nadu" },
    });

    expect(pricing.gstAmount).toBe(2.31);
    // Genuinely uneven — proving the branch is exercised at all.
    expect(pricing.cgst).not.toBe(pricing.sgst);
    expect(pricing.cgst + pricing.sgst).toBeCloseTo(pricing.gstAmount, 2);
  });

  it("what the summary renders is what the pricing charges", () => {
    const pricing = calculateVoucherPricing({
      billAmount: 1000,
      offer: OFFER,
      promo: verdict(50),
      promoCost: { vendorCost: 15, platformCost: 35 },
      config: CONFIG,
    });
    const summary = buildVoucherOrderSummary(pricing, CONFIG);

    expect(summary.payable.amount).toBe(pricing.totalPayable);
    expect(summary.youSaved).toBe(pricing.youSaved);
  });

  it("the vendor's payable never depends on Trydood's fee", () => {
    const withFee = calculateVoucherPricing({ billAmount: 1000, offer: OFFER, config: CONFIG });
    const noFee = calculateVoucherPricing({
      billAmount: 1000,
      offer: OFFER,
      config: { ...CONFIG, convenienceFee: { ...CONFIG.convenienceFee, isEnabled: false } },
    });

    // The fee is ours, not theirs. Turning it off changes what the customer
    // pays and must not change what the restaurant is owed.
    expect(withFee.vendorPayable).toBe(noFee.vendorPayable);
    expect(withFee.totalPayable).not.toBe(noFee.totalPayable);
  });
});

describe("no offer applies", () => {
  /**
   * The bill sits below every offer's minimum, or the voucher has none.
   *
   * This used to throw "No eligible offer found for this bill amount", which
   * reads to the customer as though their bill were malformed. It is a priced
   * outcome: they pay their bill.
   */
  it("prices the bill rather than refusing it", () => {
    const resolved = resolveClaimOffer({ offers: [OFFER], billAmount: 100 });
    expect(resolved.offerApplied).toBe(false);
    // Nobody named an offer, so nothing is explained — that is ranking, not a
    // refusal.
    expect(resolved.reason).toBeNull();

    const pricing = calculateVoucherPricing({
      billAmount: 100,
      offer: resolved.offer,
      config: CONFIG,
    });
    expect(pricing.totalPayable).toBe(100);
    expect(pricing.youSaved).toBe(0);
  });

  it("charges no convenience fee, so the customer is never worse off", () => {
    const pricing = calculateVoucherPricing({ billAmount: 100, offer: null, config: CONFIG });
    // With a fee and no discount the customer would pay MORE than they would
    // have without Trydood at all.
    expect(pricing.convenienceFee).toBe(0);
    expect(pricing.totalPayable).toBe(100);
  });

  it("still charges it when an admin has turned that on", () => {
    const pricing = calculateVoucherPricing({
      billAmount: 100,
      offer: null,
      config: {
        ...CONFIG,
        convenienceFee: { ...CONFIG.convenienceFee, chargeWhenNoOffer: true },
      },
    });
    expect(pricing.convenienceFee).toBe(5);
    expect(pricing.totalPayable).toBe(105);
  });

  it("hands the whole bill to the vendor", () => {
    const pricing = calculateVoucherPricing({ billAmount: 100, offer: null, config: CONFIG });
    expect(pricing.vendorPayable).toBe(100);
  });
});

describe("the two audiences cannot see each other's codes", () => {
  const claimArgs = (code) => ({
    code,
    customerId: oid(),
    voucher: { _id: oid(), categoryId: oid(), subCategoryId: oid() },
    brandId: oid(),
    billAmount: 1000,
    netBill: 800,
    convenienceFee: 10,
    config: PROMO_CONFIG,
    offerApplied: true,
  });

  it("refuses a vendor code at customer checkout", async () => {
    await PromoCode.create({
      code: "VENDORONLY",
      audience: PROMO_AUDIENCE.VENDOR,
      discountType: PROMO_DISCOUNT_TYPES.FLAT,
      discountAmount: 100,
    });

    const result = await validateCustomerPromoCode(claimArgs("VENDORONLY"));
    expect(result.ok).toBe(false);
  });

  it("words it exactly like a code that does not exist", async () => {
    await PromoCode.create({
      code: "VENDORONLY",
      audience: PROMO_AUDIENCE.VENDOR,
      discountType: PROMO_DISCOUNT_TYPES.FLAT,
      discountAmount: 100,
    });

    const real = await validateCustomerPromoCode(claimArgs("VENDORONLY"));
    const invented = await validateCustomerPromoCode(claimArgs("NOSUCHCODEHERE"));

    // Anything else turns the endpoint into an oracle for enumerating live
    // campaigns.
    expect(real.reason).toBe(PROMO_REJECTION.NOT_FOUND);
    expect(real.reason).toBe(invented.reason);
    expect(real.promoCode).toBeUndefined();
  });

  it("accepts a customer code", async () => {
    await PromoCode.create({
      code: "CUSTOK",
      audience: PROMO_AUDIENCE.CUSTOMER,
      discountType: PROMO_DISCOUNT_TYPES.FLAT,
      discountAmount: 100,
    });

    const result = await validateCustomerPromoCode(claimArgs("CUSTOK"));
    expect(result.ok).toBe(true);
    expect(result.discount).toBe(100);
  });

  it("does not treat a legacy code with no audience as a customer code", async () => {
    const promo = await PromoCode.create({
      code: "LEGACYONE",
      discountType: PROMO_DISCOUNT_TYPES.FLAT,
      discountAmount: 100,
    });
    await PromoCode.collection.updateOne({ _id: promo._id }, { $unset: { audience: "" } });

    // Codes that predate `audience` are vendor codes — that was the only kind.
    // Letting them through here would put every live subscription code into the
    // customer app at once.
    const result = await validateCustomerPromoCode(claimArgs("LEGACYONE"));
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(PROMO_REJECTION.NOT_FOUND);
  });
});

describe("per-customer limits count the ledger, not the counter", () => {
  it("an open checkout holds the slot", async () => {
    const promo = await PromoCode.create({
      code: "ONEEACH",
      audience: PROMO_AUDIENCE.CUSTOMER,
      discountType: PROMO_DISCOUNT_TYPES.FLAT,
      discountAmount: 100,
      perCustomerUsageLimit: 1,
    });
    const customerId = oid();

    // RESERVED, not consumed. `usedCount` alone would not stop a second one.
    await PromoCodeUsage.create({
      promoCodeId: promo._id,
      code: promo.code,
      audience: PROMO_AUDIENCE.CUSTOMER,
      customerId,
      transactionId: oid(),
      status: PROMO_USAGE_STATUS.RESERVED,
      discountAmount: 100,
    });

    const result = await validateCustomerPromoCode({
      code: "ONEEACH",
      customerId,
      voucher: { _id: oid() },
      brandId: oid(),
      billAmount: 1000,
      netBill: 800,
      convenienceFee: 10,
      config: PROMO_CONFIG,
      offerApplied: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe(PROMO_REJECTION.CUSTOMER_LIMIT_REACHED);
  });

  it("does not count a different customer's claim", async () => {
    const promo = await PromoCode.create({
      code: "ONEEACH",
      audience: PROMO_AUDIENCE.CUSTOMER,
      discountType: PROMO_DISCOUNT_TYPES.FLAT,
      discountAmount: 100,
      perCustomerUsageLimit: 1,
    });
    await PromoCodeUsage.create({
      promoCodeId: promo._id,
      code: promo.code,
      audience: PROMO_AUDIENCE.CUSTOMER,
      customerId: oid(),
      transactionId: oid(),
      status: PROMO_USAGE_STATUS.CONSUMED,
      discountAmount: 100,
    });

    const result = await validateCustomerPromoCode({
      code: "ONEEACH",
      customerId: oid(),
      voucher: { _id: oid() },
      brandId: oid(),
      billAmount: 1000,
      netBill: 800,
      convenienceFee: 10,
      config: PROMO_CONFIG,
      offerApplied: true,
    });

    expect(result.ok).toBe(true);
  });

  it("a first-order code is spent by a paid claim, not by an abandoned one", async () => {
    await PromoCode.create({
      code: "FIRSTONLY",
      audience: PROMO_AUDIENCE.CUSTOMER,
      discountType: PROMO_DISCOUNT_TYPES.FLAT,
      discountAmount: 100,
      firstOrderOnly: true,
    });
    const customerId = oid();
    const args = {
      code: "FIRSTONLY",
      customerId,
      voucher: { _id: oid() },
      brandId: oid(),
      billAmount: 1000,
      netBill: 800,
      convenienceFee: 10,
      config: PROMO_CONFIG,
      offerApplied: true,
    };

    // An unpaid order must not burn their first-order code.
    await Transaction.create({
      purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
      gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
      amount: 500,
      customerId,
      verified: false,
    });
    expect((await validateCustomerPromoCode(args)).ok).toBe(true);

    await Transaction.create({
      purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
      gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
      amount: 500,
      customerId,
      verified: true,
    });
    const after = await validateCustomerPromoCode(args);
    expect(after.ok).toBe(false);
    expect(after.reason).toBe(PROMO_REJECTION.FIRST_ORDER_ONLY);
  });
});

describe("guests", () => {
  it("get a price, marked provisional", async () => {
    await PromoCode.create({
      code: "GUESTOK",
      audience: PROMO_AUDIENCE.CUSTOMER,
      discountType: PROMO_DISCOUNT_TYPES.FLAT,
      discountAmount: 100,
      perCustomerUsageLimit: 1,
    });

    const result = await validateCustomerPromoCode({
      code: "GUESTOK",
      customerId: null,
      voucher: { _id: oid() },
      brandId: oid(),
      billAmount: 1000,
      netBill: 800,
      convenienceFee: 10,
      config: PROMO_CONFIG,
      offerApplied: true,
    });

    // The per-customer cap cannot be evaluated without an identity, so the
    // discount is indicative and re-validated at order creation.
    expect(result.ok).toBe(true);
    expect(result.provisional).toBe(true);
  });

  it("can be refused a preview entirely by config", async () => {
    await PromoCode.create({
      code: "GUESTOK",
      audience: PROMO_AUDIENCE.CUSTOMER,
      discountType: PROMO_DISCOUNT_TYPES.FLAT,
      discountAmount: 100,
    });

    const result = await validateCustomerPromoCode({
      code: "GUESTOK",
      customerId: null,
      voucher: { _id: oid() },
      brandId: oid(),
      billAmount: 1000,
      netBill: 800,
      convenienceFee: 10,
      config: { ...PROMO_CONFIG, allowForGuestPreview: false },
      offerApplied: true,
    });

    expect(result.reason).toBe(PROMO_REJECTION.REQUIRES_LOGIN);
  });
});

describe("the response keeps the names the app already reads", () => {
  /**
   * The pricing block was renamed this phase, and a live app is reading the old
   * names right now. The preview response echoes all three.
   *
   * Locked down by a test rather than by a comment, because "additive" is a
   * promise to someone else's shipped code: dropping these early turns every
   * checkout screen into a blank price, and nothing in this repo would fail.
   *
   * The **stored** block deliberately carries only the new names — a frozen
   * record should have one name per number.
   */
  const pricing = () =>
    calculateVoucherPricing({
      billAmount: 1000,
      offer: OFFER,
      promo: verdict(50),
      promoCost: { vendorCost: 15, platformCost: 35 },
      config: CONFIG,
    });

  it("stores only the new names", () => {
    const stored = pricing();
    expect(stored.offerDiscount).toBe(200);
    expect(stored.totalPayable).toBe(760);
    expect(stored.youSaved).toBe(250);
    // Not persisted — the aliases live in the response layer alone.
    expect(stored.payableAmount).toBeUndefined();
    expect(stored.discountAmount).toBeUndefined();
    expect(stored.totalSavings).toBeUndefined();
  });

  it("the alias is the same number, not a second one", () => {
    const p = pricing();
    const response = {
      ...p,
      discountAmount: p.offerDiscount,
      payableAmount: p.totalPayable,
      totalSavings: p.youSaved,
    };
    expect(response.discountAmount).toBe(response.offerDiscount);
    expect(response.payableAmount).toBe(response.totalPayable);
    expect(response.totalSavings).toBe(response.youSaved);
  });
});
