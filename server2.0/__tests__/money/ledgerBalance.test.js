const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const LedgerEntry = require("../../models/LedgerEntry");
const { postCaptureEntries, postRefundEntries } = require("../../helpers/ledger");
const { calculateRefundSplit } = require("../../helpers/refunds");
const {
  LEDGER_ACCOUNT,
  LEDGER_DIRECTION,
} = require("../../constants/ledger");
const { GATEWAY_FEE_BEARER } = require("../../constants/transaction");

const oid = () => new mongoose.Types.ObjectId();
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Does the money come back to zero?
 *
 * ### Why this file exists
 *
 * Every other ledger test checks that a row was written with the right shape.
 * None of them added the rows up — and three defects were hiding in exactly that
 * gap, all of them invisible row-by-row:
 *
 * | Defect | Effect on a fully refunded claim |
 * |---|---|
 * | the refund debited `vendorClawback`, which is **already** net of the promo, and then credited the promo share again | `VENDOR_PAYABLE` came to rest at `+vendorPromoCost` — phantom money the next payout would hand over |
 * | `split.taxRefund` was computed and never posted | `TAX_PAYABLE` kept GST on a fee the customer got back |
 * | `COMMISSION` was reversed on refund but never posted at capture | `PLATFORM_REVENUE` went negative by a commission never earned |
 *
 * So the assertions here are **account balances**, not rows. A ledger is only
 * right if it adds up.
 */

const PRICING = {
  currency: "INR",
  billAmount: 1000,
  offerDiscount: 200,
  netBill: 800,
  promoCode: "WELCOME50",
  promoDiscount: 50,
  promoAppliesTo: "BILL",
  vendorPromoCost: 15,
  platformPromoCost: 35,
  convenienceFee: 10,
  gstAmount: 1.8,
  taxType: "GST_18",
  // ⚠️ The GST **amount** added on top of the fee, not a flag —
  // `calculateRefundSplit` does `round2(pricing.taxOnTop)`. Set to `true` it
  // silently became ₹1, and the tax reversal came out ₹0.80 short.
  taxOnTop: 1.8,
  commissionAmount: 0,
  totalPayable: 761.8,
};

const GATEWAY_FEE = 17.94;

const transaction = () => ({
  _id: oid(),
  razorpayPaymentId: `pay_${Math.random().toString(36).slice(2, 10)}`,
  gatewayFee: GATEWAY_FEE,
  gatewayFeeBearer: GATEWAY_FEE_BEARER.PLATFORM,
  paidAmount: PRICING.totalPayable,
  amount: PRICING.totalPayable,
  amountRefunded: 0,
  verifiedAt: new Date("2026-08-30T10:00:00Z"),
});

/** Every entry, summed per account. CREDIT adds, DEBIT subtracts. */
const balances = async () => {
  const rows = await LedgerEntry.find({ isDeleted: false }).lean();
  const out = {};
  for (const row of rows) {
    const signed =
      row.direction === LEDGER_DIRECTION.CREDIT ? row.amount : -row.amount;
    out[row.account] = r2((out[row.account] || 0) + signed);
  }
  return out;
};

beforeAll(async () => {
  await connectTestDb();
  await LedgerEntry.createIndexes();
});

afterAll(async () => {
  await clearCollections(LedgerEntry);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(LedgerEntry);
});

describe("a sale, then all of it refunded", () => {
  const run = async () => {
    const brandId = oid();
    const txn = transaction();
    const claim = {
      _id: oid(),
      brandId,
      claimCode: "TD-BAL001",
      pricing: PRICING,
    };

    await postCaptureEntries({ transaction: txn, claim, pricing: PRICING });
    const afterCapture = await balances();

    const split = calculateRefundSplit({
      pricing: PRICING,
      paidAmount: PRICING.totalPayable,
      requestedAmount: PRICING.totalPayable,
      gatewayFee: GATEWAY_FEE,
    });

    await postRefundEntries({
      transaction: txn,
      claim,
      split,
      refundRequest: {
        _id: oid(),
        completedAt: new Date("2026-09-01T10:00:00Z"),
      },
    });

    return { afterCapture, after: await balances(), split };
  };

  /**
   * ⚠️ The headline. `VENDOR_PAYABLE` used to settle at `+vendorPromoCost`, and
   * that balance is not academic — `getVendorBalance` reads these rows, so it is
   * money the platform believes it still owes.
   */
  it("owes the vendor nothing afterwards", async () => {
    const { afterCapture, after } = await run();

    expect(afterCapture[LEDGER_ACCOUNT.VENDOR_PAYABLE]).toBe(
      r2(PRICING.netBill - PRICING.vendorPromoCost),
    );
    expect(after[LEDGER_ACCOUNT.VENDOR_PAYABLE] || 0).toBe(0);
  });

  it("keeps no revenue it gave back", async () => {
    const { after } = await run();

    expect(after[LEDGER_ACCOUNT.PLATFORM_REVENUE] || 0).toBe(0);
  });

  /**
   * The convenience fee is returned on a full refund, so the GST charged on it
   * must go back too. `split.taxRefund` was being computed and dropped.
   */
  it("does not keep GST on a fee it returned", async () => {
    const { afterCapture, after } = await run();

    expect(afterCapture[LEDGER_ACCOUNT.TAX_PAYABLE]).toBe(PRICING.gstAmount);
    expect(after[LEDGER_ACCOUNT.TAX_PAYABLE] || 0).toBe(0);
  });

  /**
   * The one account that deliberately does **not** return to zero. Razorpay
   * keeps its MDR whether or not the sale is refunded, so the refund books the
   * loss a second time rather than undoing the first — a real cost, recorded
   * rather than wished away.
   */
  it("still carries the gateway fee as a real loss", async () => {
    const { after } = await run();

    expect(after[LEDGER_ACCOUNT.PLATFORM_COST]).toBeLessThan(0);
    // The promo we funded came back; the MDR did not, twice over.
    expect(after[LEDGER_ACCOUNT.PLATFORM_COST]).toBeCloseTo(-2 * GATEWAY_FEE, 2);
  });
});

describe("a sale, then part of it refunded", () => {
  it("leaves exactly the un-refunded share owed to the vendor", async () => {
    const brandId = oid();
    const txn = transaction();
    const claim = {
      _id: oid(),
      brandId,
      claimCode: "TD-BAL002",
      pricing: PRICING,
    };

    await postCaptureEntries({ transaction: txn, claim, pricing: PRICING });

    const split = calculateRefundSplit({
      pricing: PRICING,
      paidAmount: PRICING.totalPayable,
      requestedAmount: 300,
      gatewayFee: GATEWAY_FEE,
    });

    await postRefundEntries({
      transaction: txn,
      claim,
      split,
      refundRequest: { _id: oid(), completedAt: new Date() },
    });

    const after = await balances();
    const owedBefore = r2(PRICING.netBill - PRICING.vendorPromoCost);

    /**
     * ⚠️ Asserted against what the **ledger** models, which is deliberately not
     * `vendorClawback`.
     *
     * The ledger mirrors the capture: gross `netBill` out, the vendor's promo
     * share back. `vendorClawback` is the settlement side's figure and differs
     * in two ways on purpose — it nets out commission, which the ledger does not
     * track on the vendor's side at all, and it absorbs the split's rounding
     * residue so the balance identity closes to the paisa.
     *
     * Writing this assertion the other way round is what caught it: it came out
     * ₹0.32 adrift, which is exactly that residue. Two figures that describe the
     * same money from different sides, and neither is wrong.
     */
    expect(after[LEDGER_ACCOUNT.VENDOR_PAYABLE]).toBeCloseTo(
      r2(owedBefore - split.netBillRefund + split.vendorPromoReversal),
      2,
    );
    expect(after[LEDGER_ACCOUNT.VENDOR_PAYABLE]).toBeGreaterThan(0);

    // And the un-refunded share is genuinely what is left.
    expect(after[LEDGER_ACCOUNT.VENDOR_PAYABLE]).toBeLessThan(owedBefore);
  });

  /**
   * The convenience fee is only returned on a **full** refund, so its GST must
   * not move on a partial one. `recordLedgerEntry` skips zero amounts, so the
   * row is simply never written.
   */
  it("does not touch GST on a partial refund", async () => {
    const brandId = oid();
    const txn = transaction();
    const claim = {
      _id: oid(),
      brandId,
      claimCode: "TD-BAL003",
      pricing: PRICING,
    };

    await postCaptureEntries({ transaction: txn, claim, pricing: PRICING });
    const split = calculateRefundSplit({
      pricing: PRICING,
      paidAmount: PRICING.totalPayable,
      requestedAmount: 300,
      gatewayFee: GATEWAY_FEE,
    });

    expect(split.taxRefund).toBe(0);

    await postRefundEntries({
      transaction: txn,
      claim,
      split,
      refundRequest: { _id: oid(), completedAt: new Date() },
    });

    const after = await balances();
    expect(after[LEDGER_ACCOUNT.TAX_PAYABLE]).toBe(PRICING.gstAmount);
  });
});

describe("commission, once somebody sets a rate", () => {
  /**
   * ⚠️ `COMMISSION` was reversed on every refund and never posted at capture.
   * At the default rate of 0 that is invisible — `recordLedgerEntry` skips a
   * zero amount — so the books only start losing money the day a real rate is
   * configured. Tested at a non-zero rate for exactly that reason.
   */
  it("does not drive revenue negative on a refund", async () => {
    const brandId = oid();
    const txn = transaction();
    const withCommission = { ...PRICING, commissionAmount: 40 };
    const claim = {
      _id: oid(),
      brandId,
      claimCode: "TD-BAL004",
      pricing: withCommission,
    };

    await postCaptureEntries({
      transaction: txn,
      claim,
      pricing: withCommission,
    });

    const captured = await balances();
    expect(captured[LEDGER_ACCOUNT.PLATFORM_REVENUE]).toBe(
      r2(withCommission.convenienceFee + 40),
    );

    const split = calculateRefundSplit({
      pricing: withCommission,
      paidAmount: withCommission.totalPayable,
      requestedAmount: withCommission.totalPayable,
      gatewayFee: GATEWAY_FEE,
    });

    await postRefundEntries({
      transaction: txn,
      claim,
      split,
      refundRequest: { _id: oid(), completedAt: new Date() },
    });

    const after = await balances();
    expect(after[LEDGER_ACCOUNT.PLATFORM_REVENUE] || 0).toBe(0);
  });
});

/**
 * ⚠️ GST **inclusive** — the configuration where the fee and the tax overlap.
 *
 * `calculateVoucherPricing` puts the whole slab in `convenienceFee` and backs
 * the tax out into `gstAmount`, leaving `taxOnTop: 0`. The ledger used to credit
 * the gross fee to `PLATFORM_REVENUE` **and** the tax again to `TAX_PAYABLE`, so
 * revenue was overstated by exactly the GST on every sale — and only for
 * installations with `isGstInclusive` switched on, which is why no fixture had
 * ever caught it.
 */
describe("when the convenience fee is GST-inclusive", () => {
  const INCLUSIVE = {
    ...PRICING,
    // ₹11.80 charged, of which ₹1.80 is tax already inside it.
    convenienceFee: 11.8,
    gstAmount: 1.8,
    taxOnTop: 0,
    totalPayable: 811.8,
  };

  const run = async () => {
    const brandId = oid();
    const txn = { ...transaction(), paidAmount: INCLUSIVE.totalPayable, amount: INCLUSIVE.totalPayable };
    const claim = {
      _id: oid(),
      brandId,
      claimCode: "TD-BAL005",
      pricing: INCLUSIVE,
    };

    await postCaptureEntries({ transaction: txn, claim, pricing: INCLUSIVE });
    const afterCapture = await balances();

    const split = calculateRefundSplit({
      pricing: INCLUSIVE,
      paidAmount: INCLUSIVE.totalPayable,
      requestedAmount: INCLUSIVE.totalPayable,
      gatewayFee: GATEWAY_FEE,
    });

    await postRefundEntries({
      transaction: txn,
      claim,
      split,
      refundRequest: { _id: oid(), completedAt: new Date() },
    });

    return { afterCapture, after: await balances() };
  };

  it("books the fee net of the tax hiding inside it", async () => {
    const { afterCapture } = await run();

    // ₹11.80 gross − ₹1.80 tax = ₹10.00 of actual revenue.
    expect(afterCapture[LEDGER_ACCOUNT.PLATFORM_REVENUE]).toBe(10);
    expect(afterCapture[LEDGER_ACCOUNT.TAX_PAYABLE]).toBe(1.8);
  });

  it("still comes back to zero on a full refund", async () => {
    const { after } = await run();

    expect(after[LEDGER_ACCOUNT.PLATFORM_REVENUE] || 0).toBe(0);
    expect(after[LEDGER_ACCOUNT.TAX_PAYABLE] || 0).toBe(0);
    expect(after[LEDGER_ACCOUNT.VENDOR_PAYABLE] || 0).toBe(0);
  });
});
