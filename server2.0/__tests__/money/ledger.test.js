const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const LedgerEntry = require("../../models/LedgerEntry");
const {
  recordLedgerEntry,
  reverseLedgerEntry,
  getVendorBalance,
  getVendorBalances,
  getPlatformTotals,
  postCaptureEntries,
} = require("../../helpers/ledger");
const {
  LEDGER_ENTRY_TYPE,
  LEDGER_ACCOUNT,
  LEDGER_DIRECTION,
} = require("../../constants/ledger");
const { GATEWAY_FEE_BEARER } = require("../../constants/transaction");

const oid = () => new mongoose.Types.ObjectId();

/** The plan's worked example: ₹1000 bill, 20% offer, ₹50 promo SHARED 30/70. */
const PRICING = {
  currency: "INR",
  billAmount: 1000,
  offerDiscount: 200,
  netBill: 800,
  promoCode: "WELCOME50",
  promoDiscount: 50,
  vendorPromoCost: 15,
  platformPromoCost: 35,
  convenienceFee: 10,
  gstAmount: 0,
  taxType: null,
  totalPayable: 760,
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

describe("an entry's account and direction come from its type", () => {
  /**
   * Deciding these at the call site is how two writers end up disagreeing about
   * whether a refund is a debit — and a ledger where that is possible is worse
   * than no ledger, because it looks authoritative.
   */
  it("does not need to be told where a collection goes", async () => {
    const { entry } = await recordLedgerEntry({
      entryType: LEDGER_ENTRY_TYPE.COLLECTION,
      amount: 800,
      brandId: oid(),
      transactionId: oid(),
    });

    expect(entry.account).toBe(LEDGER_ACCOUNT.VENDOR_PAYABLE);
    expect(entry.direction).toBe(LEDGER_DIRECTION.CREDIT);
  });

  it("knows a promo share is money leaving the vendor", async () => {
    const { entry } = await recordLedgerEntry({
      entryType: LEDGER_ENTRY_TYPE.VENDOR_PROMO_SHARE,
      amount: 15,
      brandId: oid(),
      transactionId: oid(),
    });
    expect(entry.direction).toBe(LEDGER_DIRECTION.DEBIT);
  });

  it("refuses a gateway fee with no account, because the bearer decides", async () => {
    await expect(
      recordLedgerEntry({
        entryType: LEDGER_ENTRY_TYPE.GATEWAY_FEE,
        amount: 17.94,
        transactionId: oid(),
      }),
    ).rejects.toMatchObject({ statusCode: 500 });
  });
});

describe("the guards that stop unreachable money", () => {
  /**
   * A `VENDOR_PAYABLE` row with no brand never appears in anyone's balance,
   * because the balance query groups by brand. It would sit in the collection
   * forever, owed to nobody, and reconcile as drift.
   */
  it("refuses a vendor-payable entry with no brand", async () => {
    await expect(
      recordLedgerEntry({
        entryType: LEDGER_ENTRY_TYPE.COLLECTION,
        amount: 800,
        transactionId: oid(),
      }),
    ).rejects.toMatchObject({ statusCode: 500 });
  });

  it("refuses an unexplained manual adjustment", async () => {
    // An adjustment nobody explained cannot be told apart from a mistake.
    await expect(
      recordLedgerEntry({
        entryType: LEDGER_ENTRY_TYPE.MANUAL_ADJUSTMENT,
        amount: 100,
        account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
        direction: LEDGER_DIRECTION.CREDIT,
        brandId: oid(),
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it("refuses a negative amount — the sign lives in the direction", async () => {
    await expect(
      recordLedgerEntry({
        entryType: LEDGER_ENTRY_TYPE.COLLECTION,
        amount: -50,
        brandId: oid(),
      }),
    ).rejects.toMatchObject({ statusCode: 500 });
  });

  it("skips a zero entry rather than filling statements with nothing", async () => {
    const result = await recordLedgerEntry({
      entryType: LEDGER_ENTRY_TYPE.VENDOR_PROMO_SHARE,
      amount: 0,
      brandId: oid(),
      transactionId: oid(),
    });
    expect(result.skipped).toBe(true);
    expect(await LedgerEntry.countDocuments({})).toBe(0);
  });
});

describe("posting the same money twice is impossible", () => {
  /**
   * The index is the guarantee, not the call site.
   *
   * A replayed webhook and a resumed settle both re-post the capture entries.
   * "We check first" cannot survive two processes checking at the same moment,
   * and `COLLECTION` posted twice credits a vendor twice for one payment.
   */
  it("reports a repeat as a duplicate, not a failure", async () => {
    const args = {
      entryType: LEDGER_ENTRY_TYPE.COLLECTION,
      amount: 800,
      brandId: oid(),
      transactionId: oid(),
    };

    const first = await recordLedgerEntry(args);
    const second = await recordLedgerEntry(args);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    // The retry gets the row that already exists, not a new one.
    expect(String(second.entry._id)).toBe(String(first.entry._id));
    expect(await LedgerEntry.countDocuments({})).toBe(1);
  });

  it("survives two concurrent posts of the same entry", async () => {
    const args = {
      entryType: LEDGER_ENTRY_TYPE.COLLECTION,
      amount: 800,
      brandId: oid(),
      transactionId: oid(),
    };

    const [a, b] = await Promise.all([
      recordLedgerEntry(args),
      recordLedgerEntry(args),
    ]);

    expect([a.duplicate, b.duplicate].filter(Boolean)).toHaveLength(1);
    expect(await LedgerEntry.countDocuments({})).toBe(1);
  });

  it("still allows types that legitimately repeat", async () => {
    const transactionId = oid();
    const brandId = oid();
    // A transaction can be partially refunded more than once.
    await recordLedgerEntry({
      entryType: LEDGER_ENTRY_TYPE.REFUND,
      amount: 100,
      account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
      direction: LEDGER_DIRECTION.DEBIT,
      brandId,
      transactionId,
    });
    await recordLedgerEntry({
      entryType: LEDGER_ENTRY_TYPE.REFUND,
      amount: 50,
      account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
      direction: LEDGER_DIRECTION.DEBIT,
      brandId,
      transactionId,
    });

    expect(await LedgerEntry.countDocuments({ transactionId })).toBe(2);
  });
});

describe("corrections are new rows, never edits", () => {
  /**
   * The reversal has to escape the very index that protects the original,
   * because it is by definition a second row of the same type on the same
   * transaction. Getting that wrong makes the correction mechanism unusable —
   * blocked by the safety mechanism.
   */
  it("can reverse an entry that the once-per-transaction index protects", async () => {
    const brandId = oid();
    const transactionId = oid();
    const { entry } = await recordLedgerEntry({
      entryType: LEDGER_ENTRY_TYPE.COLLECTION,
      amount: 800,
      brandId,
      transactionId,
      narration: "Claim TD-ABC123",
    });

    const reversal = await reverseLedgerEntry(entry, { reason: "posted in error" });

    expect(reversal.entry).toBeTruthy();
    expect(reversal.entry.direction).toBe(LEDGER_DIRECTION.DEBIT);
    expect(String(reversal.entry.reversalOf)).toBe(String(entry._id));
    expect(reversal.entry.narration).toContain("Reversal:");
  });

  it("leaves the original untouched", async () => {
    const { entry } = await recordLedgerEntry({
      entryType: LEDGER_ENTRY_TYPE.COLLECTION,
      amount: 800,
      brandId: oid(),
      transactionId: oid(),
      narration: "Claim TD-ABC123",
    });
    await reverseLedgerEntry(entry, { reason: "posted in error" });

    const original = await LedgerEntry.findById(entry._id);
    expect(original.amount).toBe(800);
    expect(original.direction).toBe(LEDGER_DIRECTION.CREDIT);
    expect(original.narration).toBe("Claim TD-ABC123");
  });

  it("nets the balance back to zero", async () => {
    const brandId = oid();
    const { entry } = await recordLedgerEntry({
      entryType: LEDGER_ENTRY_TYPE.COLLECTION,
      amount: 800,
      brandId,
      transactionId: oid(),
    });
    await reverseLedgerEntry(entry, { reason: "posted in error" });

    const { balance, entryCount } = await getVendorBalance(brandId);
    expect(balance).toBe(0);
    // Two rows, not zero: the pair is the record of what was undone.
    expect(entryCount).toBe(2);
  });
});

describe("a captured claim posts its whole story", () => {
  const transaction = {
    _id: oid(),
    razorpayPaymentId: "pay_TEST123",
    gatewayFee: 17.94,
    gatewayFeeBearer: GATEWAY_FEE_BEARER.PLATFORM,
    verifiedAt: new Date("2026-08-30T10:00:00Z"),
  };

  it("matches the plan's worked example", async () => {
    const brandId = oid();
    const claim = { _id: oid(), brandId, claimCode: "TD-ABC123" };

    const result = await postCaptureEntries({ transaction, claim, pricing: PRICING });

    // GST is off, so TAX_COLLECTED is zero and skipped: five rows, not six.
    expect(result.posted).toBe(5);

    const byType = Object.fromEntries(
      (await LedgerEntry.find({})).map((e) => [e.entryType, e]),
    );
    expect(byType.COLLECTION.amount).toBe(800);
    expect(byType.VENDOR_PROMO_SHARE.amount).toBe(15);
    expect(byType.CONVENIENCE_FEE.amount).toBe(10);
    expect(byType.PLATFORM_PROMO_COST.amount).toBe(35);
    expect(byType.GATEWAY_FEE.amount).toBe(17.94);
    expect(byType.TAX_COLLECTED).toBeUndefined();
  });

  it("leaves the vendor owed 785, exactly as the plan says", async () => {
    const brandId = oid();
    await postCaptureEntries({
      transaction,
      claim: { _id: oid(), brandId, claimCode: "TD-ABC123" },
      pricing: PRICING,
    });

    // 800 collected − 15 promo share.
    const { balance } = await getVendorBalance(brandId);
    expect(balance).toBe(785);
  });

  /**
   * The finding this entry exists for.
   *
   * Razorpay settles net: ₹760 in, about ₹742 arrives. The vendor is paid on the
   * gross figure, so the difference used to come silently out of the platform's
   * margin and appear in no report at all.
   */
  it("records the gateway fee against whoever bears it", async () => {
    await postCaptureEntries({
      transaction,
      claim: { _id: oid(), brandId: oid(), claimCode: "TD-ABC123" },
      pricing: PRICING,
    });

    const fee = await LedgerEntry.findOne({ entryType: LEDGER_ENTRY_TYPE.GATEWAY_FEE });
    expect(fee.account).toBe(LEDGER_ACCOUNT.PLATFORM_COST);
    expect(fee.direction).toBe(LEDGER_DIRECTION.DEBIT);
    // Matchable against a Razorpay statement, which an id alone would not be.
    expect(fee.narration).toContain("pay_TEST123");
  });

  it("charges the vendor instead when the bearer says so", async () => {
    const brandId = oid();
    await postCaptureEntries({
      transaction: { ...transaction, gatewayFeeBearer: GATEWAY_FEE_BEARER.VENDOR },
      claim: { _id: oid(), brandId, claimCode: "TD-ABC123" },
      pricing: PRICING,
    });

    const fee = await LedgerEntry.findOne({ entryType: LEDGER_ENTRY_TYPE.GATEWAY_FEE });
    expect(fee.account).toBe(LEDGER_ACCOUNT.VENDOR_PAYABLE);
    // 800 − 15 − 17.94
    const { balance } = await getVendorBalance(brandId);
    expect(balance).toBe(767.06);
  });

  it("is safe to run again — which is what the resume job does", async () => {
    const brandId = oid();
    const claim = { _id: oid(), brandId, claimCode: "TD-ABC123" };

    await postCaptureEntries({ transaction, claim, pricing: PRICING });
    const second = await postCaptureEntries({ transaction, claim, pricing: PRICING });

    expect(second.posted).toBe(0);
    expect(second.duplicates).toBe(5);
    expect(await LedgerEntry.countDocuments({})).toBe(5);
    // And the balance did not double.
    expect((await getVendorBalance(brandId)).balance).toBe(785);
  });

  it("dates entries when the money moved, not when they were written", async () => {
    await postCaptureEntries({
      transaction,
      claim: { _id: oid(), brandId: oid(), claimCode: "TD-ABC123" },
      pricing: PRICING,
    });

    // A resumed settle running today must not move yesterday's money into
    // today's settlement cycle.
    const entry = await LedgerEntry.findOne({ entryType: LEDGER_ENTRY_TYPE.COLLECTION });
    expect(entry.occurredAt.toISOString()).toBe("2026-08-30T10:00:00.000Z");
  });

  it("skips the rows a claim without a promo would not have", async () => {
    const noPromo = {
      ...PRICING,
      promoCode: null,
      promoDiscount: 0,
      vendorPromoCost: 0,
      platformPromoCost: 0,
      netBill: 800,
    };
    const result = await postCaptureEntries({
      transaction,
      claim: { _id: oid(), brandId: oid(), claimCode: "TD-ABC123" },
      pricing: noPromo,
    });

    // COLLECTION, CONVENIENCE_FEE, GATEWAY_FEE — and nothing that says nothing.
    expect(result.posted).toBe(3);
  });
});

describe("balances", () => {
  it("is a plain sum with no clause to forget", async () => {
    const brandId = oid();
    await recordLedgerEntry({
      entryType: LEDGER_ENTRY_TYPE.COLLECTION,
      amount: 800,
      brandId,
      transactionId: oid(),
    });
    await recordLedgerEntry({
      entryType: LEDGER_ENTRY_TYPE.PAYOUT,
      amount: 500,
      brandId,
      settlementId: oid(),
    });

    const { balance, credited, debited } = await getVendorBalance(brandId);
    expect(credited).toBe(800);
    expect(debited).toBe(500);
    expect(balance).toBe(300);
  });

  it("ignores another brand's rows", async () => {
    const mine = oid();
    await recordLedgerEntry({
      entryType: LEDGER_ENTRY_TYPE.COLLECTION,
      amount: 800,
      brandId: mine,
      transactionId: oid(),
    });
    await recordLedgerEntry({
      entryType: LEDGER_ENTRY_TYPE.COLLECTION,
      amount: 999,
      brandId: oid(),
      transactionId: oid(),
    });

    expect((await getVendorBalance(mine)).balance).toBe(800);
  });

  it("ignores the platform's own accounts", async () => {
    const brandId = oid();
    await recordLedgerEntry({
      entryType: LEDGER_ENTRY_TYPE.COLLECTION,
      amount: 800,
      brandId,
      transactionId: oid(),
    });
    // A convenience fee is ours, not theirs, even though it came from their sale.
    await recordLedgerEntry({
      entryType: LEDGER_ENTRY_TYPE.CONVENIENCE_FEE,
      amount: 10,
      brandId,
      transactionId: oid(),
    });

    expect((await getVendorBalance(brandId)).balance).toBe(800);
  });

  /**
   * A statement is "as at" a date. Re-reading today's balance for last month's
   * statement would restate a document already sent to a vendor.
   */
  it("can be read as it stood at a moment", async () => {
    const brandId = oid();
    await recordLedgerEntry({
      entryType: LEDGER_ENTRY_TYPE.COLLECTION,
      amount: 800,
      brandId,
      transactionId: oid(),
      occurredAt: new Date("2026-08-01T00:00:00Z"),
    });
    await recordLedgerEntry({
      entryType: LEDGER_ENTRY_TYPE.COLLECTION,
      amount: 500,
      brandId,
      transactionId: oid(),
      occurredAt: new Date("2026-09-01T00:00:00Z"),
    });

    const august = await getVendorBalance(brandId, { upTo: new Date("2026-08-31T23:59:59Z") });
    expect(august.balance).toBe(800);
    expect((await getVendorBalance(brandId)).balance).toBe(1300);
  });

  it("answers for many brands in one pass", async () => {
    const a = oid();
    const b = oid();
    await recordLedgerEntry({
      entryType: LEDGER_ENTRY_TYPE.COLLECTION, amount: 800, brandId: a, transactionId: oid(),
    });
    await recordLedgerEntry({
      entryType: LEDGER_ENTRY_TYPE.COLLECTION, amount: 300, brandId: b, transactionId: oid(),
    });

    const map = await getVendorBalances([a, b, oid()]);
    expect(map.get(String(a)).balance).toBe(800);
    expect(map.get(String(b)).balance).toBe(300);
    // A brand with no rows is absent rather than zero — the caller decides what
    // "never traded" means.
    expect(map.size).toBe(2);
  });

  it("shows the platform what a claim actually earned", async () => {
    await postCaptureEntries({
      transaction: {
        _id: oid(),
        razorpayPaymentId: "pay_TEST123",
        gatewayFee: 17.94,
        gatewayFeeBearer: GATEWAY_FEE_BEARER.PLATFORM,
        verifiedAt: new Date(),
      },
      claim: { _id: oid(), brandId: oid(), claimCode: "TD-ABC123" },
      pricing: PRICING,
    });

    const totals = await getPlatformTotals();
    expect(totals.revenue).toBe(10);
    // 35 promo share + 17.94 gateway fee, reported as a positive cost.
    expect(totals.cost).toBe(52.94);
    /**
     * The platform LOST money on this claim, and the number has to say so.
     *
     * An earlier version reported `credited - debited` for every account, which
     * made cost negative and turned `revenue - cost` into `revenue + cost` —
     * this same claim reported a 62.94 profit. A sign error with the right
     * shape is exactly what a ledger is meant to make impossible.
     */
    expect(totals.net).toBe(-42.94);
    expect(totals.byAccount[LEDGER_ACCOUNT.PLATFORM_COST]).toBe(52.94);
  });
});
