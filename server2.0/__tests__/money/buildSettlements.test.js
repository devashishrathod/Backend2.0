const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const RefundRequest = require("../../models/RefundRequest");
const Settlement = require("../../models/Settlement");
const SettlementHistory = require("../../models/SettlementHistory");
const Setting = require("../../models/Setting");
const Brand = require("../../models/Brand");
const Bank = require("../../models/Bank");
const { buildSettlements, computeTotals } = require("../../services/settlements");
const { SETTLEMENT_STATUS } = require("../../constants/settlement");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");
const { REFUND_REQUEST_STATUS, REFUND_REASON } = require("../../constants/refund");
const { PAYMENT_STATUS } = require("../../constants");
const { settlementPeriodEnd } = require("../../helpers/dates");
const { generateBrandMerchantId } = require("../../helpers/brands");

/**
 * ⚠️ `Brand.merchantId` is validated against `TM-XXXX-XXXX-XXXX` over a charset
 * that comes from `MERCHANT_ID_SECRET`. Inventing a plausible-looking string
 * fails validation, so the fixture uses the **real** generator — which is also
 * the only version that stays correct if the format ever changes.
 */
const seedBrand = async (overrides = {}) =>
  Brand.create({
    brandName: "test brand",
    uniqueId: `TDB${Date.now()}${Math.floor(Math.random() * 1000)}`,
    userId: oid(),
    merchantId: await generateBrandMerchantId(),
    ...overrides,
  });

const oid = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms);

let BRAND;

/** Eligible by default: captured 5 days ago, settled to us 2 days ago. */
const payment = (overrides = {}) => ({
  purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
  gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
  customerId: oid(),
  brandId: BRAND,
  amount: 810,
  paidAmount: 810,
  status: PAYMENT_STATUS.CAPTURED,
  verified: true,
  verifiedAt: ago(5 * DAY),
  fundsReceivedAt: ago(2 * DAY),
  settlementHold: false,
  amountRefunded: 0,
  voucher: {
    netBill: 800,
    vendorPayable: 800,
    vendorPromoCost: 0,
    commissionAmount: 0,
  },
  ...overrides,
});

const setSetting = (path, value) =>
  Setting.findOneAndUpdate(
    {},
    { $set: { [`customer.settlement.${path}`]: value } },
    { upsert: true, returnDocument: "after" },
  );

beforeAll(async () => {
  await connectTestDb();
  for (const m of [
    Transaction,
    RefundRequest,
    Settlement,
    SettlementHistory,
    Brand,
    Bank,
  ]) {
    await m.createIndexes();
  }
});

afterAll(async () => {
  await clearCollections(
    Transaction,
    RefundRequest,
    Settlement,
    SettlementHistory,
    Setting,
    Brand,
    Bank,
  );
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(
    Transaction,
    RefundRequest,
    Settlement,
    SettlementHistory,
    Setting,
    Brand,
    Bank,
  );
  BRAND = oid();
});

describe("one day, one settlement per brand", () => {
  it("builds a settlement from the day's takings", async () => {
    await Transaction.create(payment());
    await Transaction.create(payment());

    const result = await buildSettlements();

    expect(result.built).toBe(1);
    const s = await Settlement.findOne({ brandId: BRAND }).lean();
    expect(s.status).toBe(SETTLEMENT_STATUS.PENDING_APPROVAL);
    expect(s.transactionCount).toBe(2);
    expect(s.grossCollected).toBe(1600);
    expect(s.netPayable).toBe(1600);
  });

  /**
   * ⚠️ `jobs/index.js` runs every job once at boot, before the interval starts,
   * and the runner is per-process — so a restart or a second instance runs this
   * again. The canonical `periodEnd` plus the unique index is what makes that
   * harmless; `new Date()` in the key would produce a settlement per run.
   */
  it("is safe to run ten times", async () => {
    await Transaction.create(payment());

    for (let i = 0; i < 10; i += 1) await buildSettlements();

    expect(await Settlement.countDocuments({ brandId: BRAND })).toBe(1);
  });

  it("is safe to run twice at the same moment", async () => {
    await Transaction.create(payment());

    await Promise.all([buildSettlements(), buildSettlements()]);

    expect(await Settlement.countDocuments({ brandId: BRAND })).toBe(1);
  });

  /**
   * A re-run does not even reach the shell: the rows it would have looked at are
   * already claimed, so `brandsWithEligibleMoney` returns nothing. That is the
   * cheaper and more correct outcome — `skipped` counts only the narrower case
   * where a brand has **new** eligible money and the period is already built.
   */
  it("does nothing on a re-run, and builds nothing twice", async () => {
    await Transaction.create(payment());

    await buildSettlements();
    const second = await buildSettlements();

    expect(second.built).toBe(0);
    expect(second.brandsChecked).toBe(0);
    expect(await Settlement.countDocuments({ brandId: BRAND })).toBe(1);
  });

  it("skips the shell when new money lands after the period was built", async () => {
    await Transaction.create(payment());
    await buildSettlements();

    // A late capture for the same period — the day is already settled.
    await Transaction.create(payment());
    const second = await buildSettlements();

    expect(second.skipped).toBe(1);
    expect(second.built).toBe(0);
  });

  it("builds one per brand, not one for everyone", async () => {
    const other = oid();
    await Transaction.create(payment());
    await Transaction.create(payment({ brandId: other }));

    const result = await buildSettlements();

    expect(result.brandsChecked).toBe(2);
    expect(result.built).toBe(2);
  });

  /**
   * A platform with ten thousand brands and forty active ones should not open
   * ten thousand shells to discover that.
   */
  it("ignores brands with nothing to settle", async () => {
    await seedBrand({ brandName: "quiet brand" });

    const result = await buildSettlements();
    expect(result.brandsChecked).toBe(0);
    expect(result.built).toBe(0);
  });
});

describe("what it will not settle", () => {
  /**
   * ⚠️ `verifiedAt` says the customer paid. Razorpay holds that money for its own
   * cycle first, so paying it out is funding the payout ourselves.
   */
  it("skips money the gateway has not settled to us", async () => {
    await Transaction.create(payment({ fundsReceivedAt: null }));

    const result = await buildSettlements();
    expect(result.built).toBe(0);
  });

  it("respects the payout buffer", async () => {
    await setSetting("payoutBufferHours", 48);
    // Settled to us an hour ago — inside the buffer.
    await Transaction.create(payment({ fundsReceivedAt: ago(60 * 60 * 1000) }));

    expect((await buildSettlements()).built).toBe(0);
  });

  /**
   * The chargeback we **lost** sets `isDisputed` back to `false`. Only
   * `settlementHold` carries ineligibility.
   */
  it("skips a held payment even when it is not currently disputed", async () => {
    await Transaction.create(payment({ settlementHold: true, isDisputed: false }));

    expect((await buildSettlements()).built).toBe(0);
  });

  /**
   * ⚠️ Was `built: 0`, and that was the bug.
   *
   * Skipping the payment did not merely delay the vendor's remaining share — it
   * removed it from every future cycle, because `amountRefunded` only ever goes
   * up. The clawback for the refunded part was still deducted elsewhere, so the
   * vendor paid for the refund twice over and was never paid for the sale.
   */
  it("builds for a partially refunded payment — the remainder is still owed", async () => {
    await Transaction.create(payment({ amountRefunded: 300, isRefunded: false }));

    expect((await buildSettlements()).built).toBe(1);
  });

  /** A fully refunded payment is genuinely not the vendor's, and stays out. */
  it("skips a fully refunded payment", async () => {
    await Transaction.create(payment({ amountRefunded: 810, isRefunded: true }));

    expect((await buildSettlements()).built).toBe(0);
  });

  it("does nothing at all when settlement is switched off", async () => {
    await setSetting("isEnabled", false);
    await Transaction.create(payment());

    const result = await buildSettlements();
    expect(result.skipped).toBe(true);
    expect(await Settlement.countDocuments({})).toBe(0);
  });
});

describe("nothing to pay is an outcome, not a failure", () => {
  /**
   * ⚠️ A `PAID` settlement writes a `PAYOUT` ledger entry, and booking a payout
   * for money no bank transfer carried makes `reconcileLedger` shout about drift
   * without saying which settlement caused it.
   */
  it("carries forward when the refunds outweigh the takings", async () => {
    const txn = await Transaction.create(payment());
    const req = await RefundRequest.create({
      claimId: oid(),
      transactionId: txn._id,
      customerId: oid(),
      brandId: BRAND,
      claimCode: "TD-ACD349",
      requestedAmount: 900,
      split: { totalRefund: 900, vendorClawback: 900 },
      reason: REFUND_REASON.NOT_HONOURED,
    });
    req.status = REFUND_REQUEST_STATUS.COMPLETED;
    await req.save();

    const result = await buildSettlements();

    expect(result.carriedForward).toBe(1);
    const s = await Settlement.findOne({ brandId: BRAND }).lean();
    expect(s.status).toBe(SETTLEMENT_STATUS.CARRIED_FORWARD);
    expect(s.netPayable).toBeLessThan(0);
  });

  it("carries forward a brand below the minimum payout", async () => {
    await setSetting("minPayoutAmount", 5000);
    await Transaction.create(payment());

    const result = await buildSettlements();

    expect(result.carriedForward).toBe(1);
    const s = await Settlement.findOne({ brandId: BRAND }).lean();
    expect(s.status).toBe(SETTLEMENT_STATUS.CARRIED_FORWARD);
  });

  /**
   * ⚠️ Releasing **is** the carry-forward. Eligibility has no `periodStart`
   * floor, so both the takings and the unapplied deductions flow into the next
   * cycle by themselves and net off there.
   */
  it("gives the rows back so the next cycle picks them up", async () => {
    await setSetting("minPayoutAmount", 5000);
    const txn = await Transaction.create(payment());

    await buildSettlements();

    const after = await Transaction.findById(txn._id).lean();
    expect(after.settlementId).toBeNull();
  });

  it("says why in the history row", async () => {
    await setSetting("minPayoutAmount", 5000);
    await Transaction.create(payment());
    await buildSettlements();

    const s = await Settlement.findOne({ brandId: BRAND }).lean();
    const rows = await SettlementHistory.find({ settlementId: s._id }).lean();
    expect(rows[0].reason).toMatch(/below the ₹5000 minimum/i);
  });
});

describe("the arithmetic", () => {
  const settings = { reserve: { isEnabled: false } };

  /**
   * `netBill`, not `amount`. The customer paid `amount`, which includes our
   * convenience fee and is net of a promo we may have funded — none of that is
   * the vendor's.
   */
  it("pays on the net bill, not on what the customer paid", () => {
    const totals = computeTotals({
      transactions: [{ voucher: { netBill: 800 }, amount: 810, paidAmount: 810 }],
      refunds: [],
      settings,
    });

    expect(totals.grossCollected).toBe(800);
    expect(totals.netPayable).toBe(800);
  });

  it("takes off the vendor's own promo share and commission", () => {
    const totals = computeTotals({
      transactions: [
        { voucher: { netBill: 800, vendorPromoCost: 20, commissionAmount: 24 } },
      ],
      refunds: [],
      settings,
    });

    expect(totals.netPayable).toBe(756);
  });

  /**
   * `vendorClawback`, not `totalRefund` — what the customer got back includes
   * our convenience fee and our share of a promo, and neither comes out of the
   * vendor.
   */
  it("deducts only the vendor's share of a refund", () => {
    const totals = computeTotals({
      transactions: [{ voucher: { netBill: 800 } }],
      refunds: [{ split: { totalRefund: 810, vendorClawback: 780 } }],
      settings,
    });

    expect(totals.refundAdjustment).toBe(780);
    expect(totals.netPayable).toBe(20);
  });

  it("holds a reserve only when one is switched on", () => {
    const off = computeTotals({
      transactions: [{ voucher: { netBill: 1000 } }],
      refunds: [],
      settings: { reserve: { isEnabled: false, percent: 5 } },
    });
    const on = computeTotals({
      transactions: [{ voucher: { netBill: 1000 } }],
      refunds: [],
      settings: { reserve: { isEnabled: true, percent: 5 } },
    });

    expect(off.reserveHeld).toBe(0);
    expect(on.reserveHeld).toBe(50);
    expect(on.netPayable).toBe(950);
  });

  /** A reserve is only ever held back from money that exists. */
  it("does not hold a reserve out of a negative balance", () => {
    const totals = computeTotals({
      transactions: [{ voucher: { netBill: 100 } }],
      refunds: [{ split: { vendorClawback: 500 } }],
      settings: { reserve: { isEnabled: true, percent: 5 } },
    });

    expect(totals.reserveHeld).toBe(0);
    expect(totals.netPayable).toBe(-400);
  });
});

describe("the bank account is frozen at build time", () => {
  const seedBank = async (overrides = {}) => {
    /**
     * ⚠️ `models/Bank.js` is a **CGPEY penny-drop verification record**, not a
     * bank-account model — fourteen required fields, all of which only get
     * filled by a paid verification call. The fixture has to look like one.
     */
    const bank = await Bank.create({
      brandId: BRAND,
      accountHolderName: "Cafe Mocha",
      accountNumber: "1234567890",
      maskedAccountNumber: "XXXXXX7890",
      accountLast4Digits: "7890",
      ifscCode: "HDFC0001234",
      bankName: "HDFC Bank",
      isValid: true,
      recommendedAction: "PROCEED",
      verificationResponse: { status: "SUCCESS" },
      verificationMessage: "Account verified",
      providerTransactionId: `CG${Date.now()}`,
      providerRequestId: `RQ${Date.now()}`,
      isVerified: true,
      verifiedAt: new Date(),
      ...overrides,
    });
    await seedBrand({ _id: BRAND, brandName: "cafe mocha", BankId: bank._id });
    return bank;
  };

  /**
   * ⚠️ `createBank.js` soft-deletes the old record and repoints `brand.BankId`
   * when a vendor changes their account. A settlement built on Monday and paid on
   * Thursday would otherwise follow the pointer to whatever is there on
   * Thursday — quietly redirecting a payout an admin already approved. NEFT has
   * no recall.
   */
  it("copies the account onto the settlement", async () => {
    await seedBank();
    await Transaction.create(payment());

    await buildSettlements();

    const s = await Settlement.findOne({ brandId: BRAND }).lean();
    expect(s.bankSnapshot.accountLast4Digits).toBe("7890");
    expect(s.bankSnapshot.ifscCode).toBe("HDFC0001234");
  });

  /**
   * ⚠️ `models/Bank.js` is a CGPEY **penny-drop verification record**, so a row
   * can exist for an account the drop failed on. Paying to an unverified account
   * is the one payout mistake with no recall.
   */
  it("refuses to snapshot an unverified account", async () => {
    await seedBank({ isVerified: false });
    await Transaction.create(payment());

    await buildSettlements();

    const s = await Settlement.findOne({ brandId: BRAND }).lean();
    // The settlement is still built — the money is owed either way — and the
    // payout step is what refuses to run.
    expect(s.status).toBe(SETTLEMENT_STATUS.PENDING_APPROVAL);
    expect(s.bankSnapshot).toBeUndefined();
  });

  it("still builds when the brand has no bank at all", async () => {
    await Transaction.create(payment());

    const result = await buildSettlements();
    expect(result.built).toBe(1);
  });
});

describe("the period is canonical", () => {
  it("keys the settlement on the IST day, not the run time", async () => {
    await Transaction.create(payment());
    await buildSettlements();

    const s = await Settlement.findOne({ brandId: BRAND }).lean();
    expect(s.idempotencyKey).toBe(
      `STL:${BRAND}:${settlementPeriodEnd(3).toISOString()}`,
    );
  });

  it("spans exactly one whole day", async () => {
    await Transaction.create(payment());
    await buildSettlements();

    const s = await Settlement.findOne({ brandId: BRAND }).lean();
    expect(s.periodEnd.getTime() - s.periodStart.getTime()).toBe(DAY - 1);
  });
});
