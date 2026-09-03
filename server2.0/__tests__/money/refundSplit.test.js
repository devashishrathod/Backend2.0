const { calculateRefundSplit } = require("../../helpers/refunds");
const { PROMO_APPLIES_TO } = require("../../constants/promoCode");

/**
 * The split decides whose pocket a refund comes out of, so every case here is a
 * case where getting it wrong moves real money to the wrong party.
 *
 * No database: this is arithmetic over a frozen snapshot, and a test that needs
 * a cluster to check arithmetic is a slower test that proves the same thing.
 */

/** billAmount 1000 − offer 200 = netBill 800, fee 10, nothing else. */
const plain = {
  netBill: 800,
  convenienceFee: 10,
  promoDiscount: 0,
  vendorPromoCost: 0,
  platformPromoCost: 0,
  commissionAmount: 0,
  taxOnTop: 0,
};

const split = (overrides = {}) =>
  calculateRefundSplit({
    pricing: plain,
    paidAmount: 810,
    requestedAmount: 810,
    ...overrides,
  });

/**
 * The identity the helper asserts internally, restated here so a change that
 * loosens the assertion still has to get past a test.
 */
const balances = (s) => {
  const total =
    s.vendorClawback +
    s.commissionReversal -
    s.platformPromoReversal +
    s.convenienceFeeRefund +
    s.taxRefund;
  return Math.abs(total - s.totalRefund) < 0.005;
};

describe("a full refund gives back exactly what was paid", () => {
  it("returns the net bill and the fee", () => {
    const s = split();

    expect(s.totalRefund).toBe(810);
    expect(s.vendorClawback).toBe(800);
    expect(s.convenienceFeeRefund).toBe(10);
    expect(s.isFullRefund).toBe(true);
    expect(balances(s)).toBe(true);
  });

  /**
   * Razorpay does not return its fee when a payment is refunded. It is a
   * straight loss, and it is recorded as one so it shows up in the ledger
   * instead of quietly eroding margin.
   */
  it("records the gateway fee as ours to absorb", () => {
    const s = split({ gatewayFee: 17.94 });
    expect(s.gatewayFeeAbsorbed).toBe(17.94);
    // Not part of what the customer gets — it never left their pocket.
    expect(s.totalRefund).toBe(810);
  });

  it("returns the GST charged on the fee", () => {
    const s = calculateRefundSplit({
      pricing: { ...plain, taxOnTop: 1.8 },
      paidAmount: 811.8,
      requestedAmount: 811.8,
    });

    expect(s.taxRefund).toBe(1.8);
    expect(s.convenienceFeeRefund).toBe(10);
    expect(s.vendorClawback).toBe(800);
    expect(balances(s)).toBe(true);
  });
});

describe("a promo is reversed by whoever paid for it", () => {
  /**
   * ₹35 off the net bill, split ₹20 vendor / ₹15 us. The customer paid ₹775.
   */
  it("splits a net-bill promo between the two of us", () => {
    const s = calculateRefundSplit({
      pricing: {
        ...plain,
        promoAppliesTo: PROMO_APPLIES_TO.NET_BILL,
        promoDiscount: 35,
        vendorPromoCost: 20,
        platformPromoCost: 15,
      },
      paidAmount: 775,
      requestedAmount: 775,
    });

    expect(s.totalRefund).toBe(775);
    // The vendor was owed 800 − 20; that is what comes back off their next payout.
    expect(s.vendorClawback).toBe(780);
    expect(s.platformPromoReversal).toBe(15);
    expect(s.vendorPromoReversal).toBe(20);
    expect(balances(s)).toBe(true);
  });

  /**
   * ⚠️ The case a denormalised copy cannot see.
   *
   * `Transaction.voucher` carries `platformPromoCost` but not `promoAppliesTo`.
   * A promo taken off the **convenience fee** costs the vendor nothing — it came
   * out of our own fee. Splitting without knowing that would claw the discount
   * back from the vendor for money we gave away ourselves.
   */
  it("never charges the vendor for a promo that came off our fee", () => {
    const s = calculateRefundSplit({
      pricing: {
        ...plain,
        promoAppliesTo: PROMO_APPLIES_TO.CONVENIENCE_FEE,
        promoDiscount: 10,
        vendorPromoCost: 0,
        platformPromoCost: 10,
      },
      // netBill 800 − 0 + fee 10 − promo 10 = 800
      paidAmount: 800,
      requestedAmount: 800,
    });

    expect(s.totalRefund).toBe(800);
    // The vendor supplied ₹800 of goods and gets clawed for exactly that.
    expect(s.vendorClawback).toBe(800);
    // Nothing to give back — the customer never paid a fee.
    expect(s.convenienceFeeRefund).toBe(0);
    // And our promo is NOT subtracted again; it is already inside the zero fee.
    expect(s.platformPromoReversal).toBe(0);
    expect(balances(s)).toBe(true);
  });

  /**
   * The same numbers with the promo pointed at the net bill instead. If the two
   * came out the same, `promoAppliesTo` would not be doing anything.
   */
  it("reaches a different answer than the same promo on the net bill", () => {
    const onFee = calculateRefundSplit({
      pricing: {
        ...plain,
        promoAppliesTo: PROMO_APPLIES_TO.CONVENIENCE_FEE,
        promoDiscount: 10,
        vendorPromoCost: 0,
        platformPromoCost: 10,
      },
      paidAmount: 800,
      requestedAmount: 800,
    });

    const onBill = calculateRefundSplit({
      pricing: {
        ...plain,
        promoAppliesTo: PROMO_APPLIES_TO.NET_BILL,
        promoDiscount: 10,
        vendorPromoCost: 0,
        platformPromoCost: 10,
      },
      paidAmount: 800,
      requestedAmount: 800,
    });

    expect(onFee.convenienceFeeRefund).toBe(0);
    expect(onBill.convenienceFeeRefund).toBe(10);
    expect(onFee.platformPromoReversal).toBe(0);
    expect(onBill.platformPromoReversal).toBe(10);
    expect(balances(onFee)).toBe(true);
    expect(balances(onBill)).toBe(true);
  });
});

describe("a partial refund comes out of the vendor side only", () => {
  it("does not return the convenience fee", () => {
    const s = split({ requestedAmount: 300 });

    expect(s.isFullRefund).toBe(false);
    expect(s.convenienceFeeRefund).toBe(0);
    expect(s.vendorClawback).toBe(300);
    expect(balances(s)).toBe(true);
  });

  it("reverses a promo pro-rata", () => {
    const s = calculateRefundSplit({
      pricing: {
        ...plain,
        promoAppliesTo: PROMO_APPLIES_TO.NET_BILL,
        promoDiscount: 35,
        vendorPromoCost: 20,
        platformPromoCost: 15,
      },
      paidAmount: 775,
      // Half of the vendor-side money (765 / 2 = 382.50).
      requestedAmount: 382.5,
    });

    expect(s.platformPromoReversal).toBe(7.5);
    expect(s.vendorPromoReversal).toBe(10);
    expect(s.vendorClawback).toBe(390);
    expect(balances(s)).toBe(true);
  });

  /**
   * The fee comes back on the refund that **completes** the payment, measured
   * cumulatively. ₹300 then ₹510 leaves the customer whole, and neither refund
   * has to know what the other did.
   */
  it("returns the fee on the refund that finishes the job", () => {
    const first = split({ requestedAmount: 300 });
    expect(first.convenienceFeeRefund).toBe(0);

    const second = split({ requestedAmount: 510, alreadyRefunded: 300 });
    expect(second.isFullRefund).toBe(true);
    expect(second.convenienceFeeRefund).toBe(10);
    expect(second.vendorClawback).toBe(500);
    expect(balances(second)).toBe(true);

    // Between them the customer got back every rupee.
    expect(first.totalRefund + second.totalRefund).toBe(810);
  });

  /**
   * Razorpay keeps its fee whatever happens, so it is absorbed once. Charging a
   * share to each partial would book the same loss two and three times over.
   */
  it("absorbs the gateway fee once, not once per partial", () => {
    const first = split({ requestedAmount: 300, gatewayFee: 17.94 });
    const second = split({
      requestedAmount: 510,
      alreadyRefunded: 300,
      gatewayFee: 17.94,
    });

    expect(first.gatewayFeeAbsorbed).toBe(17.94);
    expect(second.gatewayFeeAbsorbed).toBe(0);
  });
});

describe("what it refuses to do", () => {
  /**
   * Refused, not silently capped. Trimming ₹8,100 down to ₹810 would let a
   * fat-fingered extra zero look like it was approved as typed, and the person
   * who typed it would never find out.
   */
  it("refuses more than was paid", () => {
    expect(() => split({ requestedAmount: 8100 })).toThrow(/can still be refunded/i);
  });

  it("refuses to refund what has already gone back", () => {
    expect(() =>
      split({ requestedAmount: 100, alreadyRefunded: 810 }),
    ).toThrow(/already been fully refunded/i);
  });

  it("refuses zero and negative", () => {
    expect(() => split({ requestedAmount: 0 })).toThrow(/more than zero/i);
    expect(() => split({ requestedAmount: -100 })).toThrow(/more than zero/i);
  });

  it("refuses a claim with no frozen pricing", () => {
    expect(() =>
      calculateRefundSplit({ pricing: null, paidAmount: 810, requestedAmount: 810 }),
    ).toThrow(/no pricing/i);
  });

  /**
   * If `paidAmount` and the frozen pricing disagree, one of them is wrong, and
   * guessing which would be worse than saying so.
   */
  it("refuses when the stored pricing contradicts what was charged", () => {
    expect(() =>
      calculateRefundSplit({
        // A fee far larger than the payment itself.
        pricing: { ...plain, convenienceFee: 5000 },
        paidAmount: 810,
        requestedAmount: 810,
      }),
    ).toThrow(/does not match what was charged|does not balance/i);
  });
});

describe("the books balance, or nothing goes out", () => {
  /**
   * Rounding has to land somewhere. It lands on the vendor's clawback — the
   * largest component, reconciled against the settlement it appears in, and
   * never the number shown to the customer.
   */
  it("still balances on amounts that do not divide cleanly", () => {
    for (const amount of [1, 3.33, 7.77, 99.99, 123.45, 456.78, 764.99]) {
      const s = calculateRefundSplit({
        pricing: {
          ...plain,
          promoAppliesTo: PROMO_APPLIES_TO.NET_BILL,
          promoDiscount: 35,
          vendorPromoCost: 20,
          platformPromoCost: 15,
        },
        paidAmount: 775,
        requestedAmount: amount,
      });

      expect({ amount, balanced: balances(s) }).toEqual({ amount, balanced: true });
    }
  });

  it("never produces a negative component", () => {
    for (const amount of [1, 50, 400, 810]) {
      const s = split({ requestedAmount: amount });
      for (const [key, value] of Object.entries(s)) {
        if (typeof value === "number") {
          expect({ key, negative: value < 0 }).toEqual({ key, negative: false });
        }
      }
    }
  });

  /**
   * A commission is frozen per claim and is 0 today, but it is reversed with
   * everything else — a refunded claim earned us no commission.
   */
  it("reverses commission along with the rest", () => {
    const s = calculateRefundSplit({
      pricing: { ...plain, commissionAmount: 24 },
      paidAmount: 810,
      requestedAmount: 810,
    });

    expect(s.commissionReversal).toBe(24);
    // The vendor was only ever owed 800 − 24.
    expect(s.vendorClawback).toBe(776);
    expect(balances(s)).toBe(true);
  });
});
