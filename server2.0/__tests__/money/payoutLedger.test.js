const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Settlement = require("../../models/Settlement");
const SettlementHistory = require("../../models/SettlementHistory");
const PayoutLeg = require("../../models/PayoutLeg");
const LedgerEntry = require("../../models/LedgerEntry");
const Transaction = require("../../models/Transaction");
const Brand = require("../../models/Brand");
const Bank = require("../../models/Bank");
const {
  startPayout,
  confirmPayout,
  reversePayout,
} = require("../../services/settlements");
const {
  postPayoutEntries,
  reversePayoutEntries,
  getVendorBalance,
} = require("../../helpers/ledger");
const { generateBrandMerchantId } = require("../../helpers/brands");
const { SETTLEMENT_STATUS } = require("../../constants/settlement");
const { PAYOUT_TYPE, PAYOUT_LEG_STATUS } = require("../../constants/payout");
const {
  LEDGER_ENTRY_TYPE,
  LEDGER_ACCOUNT,
  LEDGER_DIRECTION,
} = require("../../constants/ledger");
const { ROLES } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms);

let BRAND;
let BANK_ID;

const admin = () => ({ role: ROLES.ADMIN, userId: oid() });

const seedBank = async (overrides = {}) => {
  const bank = await Bank.create({
    brandId: BRAND,
    accountHolderName: "Cafe Mocha",
    // Padded: `isValidAccountNumber` wants 9-18 digits, and an unpadded
    // random tail dropped below that roughly one run in a hundred — a
    // ValidationError in a fixture that reads as a flaky money test.
    accountNumber: `12345${String(Math.floor(Math.random() * 100000)).padStart(5, "0")}`,
    maskedAccountNumber: "XXXXXX7890",
    accountLast4Digits: "7890",
    ifscCode: "HDFC0001234",
    bankName: "HDFC Bank",
    isValid: true,
    recommendedAction: "PROCEED",
    verificationResponse: { status: "SUCCESS" },
    verificationMessage: "Account verified",
    providerTransactionId: `CG${Date.now()}${Math.random()}`,
    providerRequestId: `RQ${Date.now()}${Math.random()}`,
    isVerified: true,
    verifiedAt: new Date(),
    ...overrides,
  });
  BANK_ID = bank._id;

  await Brand.findOneAndUpdate(
    { _id: BRAND },
    {
      $set: { BankId: bank._id },
      $setOnInsert: {
        brandName: "cafe mocha",
        uniqueId: `TDB${Date.now()}${Math.floor(Math.random() * 1000)}`,
        userId: oid(),
        merchantId: await generateBrandMerchantId(),
      },
    },
    { upsert: true },
  );
  return bank;
};

const settlement = async (overrides = {}) => {
  const bank = await Bank.findById(BANK_ID).lean();
  return Settlement.create({
    brandId: BRAND,
    settlementNumber: `TD/STL/26-27/${Math.floor(Math.random() * 1e6)}`,
    periodStart: ago(6 * DAY),
    periodEnd: ago(3 * DAY),
    idempotencyKey: `STL:${BRAND}:${Date.now()}:${Math.random()}`,
    status: SETTLEMENT_STATUS.APPROVED,
    bankSnapshot: {
      accountHolderName: bank.accountHolderName,
      maskedAccountNumber: bank.maskedAccountNumber,
      accountLast4Digits: bank.accountLast4Digits,
      ifscCode: bank.ifscCode,
      bankName: bank.bankName,
      bankId: bank._id,
    },
    grossCollected: 1600,
    netPayable: 1600,
    reserveHeld: 0,
    transactionCount: 2,
    ...overrides,
  });
};

const ledgerFor = (settlementId) =>
  LedgerEntry.find({ settlementId }).lean();

beforeAll(async () => {
  await connectTestDb();
  for (const m of [
    Settlement,
    SettlementHistory,
    PayoutLeg,
    LedgerEntry,
    Transaction,
    Brand,
    Bank,
  ]) {
    await m.createIndexes();
  }
});

afterAll(async () => {
  await clearCollections(
    Settlement,
    SettlementHistory,
    PayoutLeg,
    LedgerEntry,
    Transaction,
    Brand,
    Bank,
  );
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(
    Settlement,
    SettlementHistory,
    PayoutLeg,
    LedgerEntry,
    Transaction,
    Brand,
    Bank,
  );
  BRAND = oid();
  BANK_ID = null;
  await seedBank();
});

describe("a payout books what actually left", () => {
  it("debits the brand's payable when the money is confirmed", async () => {
    const s = await settlement();
    await startPayout(admin(), s._id);
    await confirmPayout(admin(), s._id, { utr: "N123456789012345" });

    const rows = await ledgerFor(s._id);
    const payout = rows.find((r) => r.entryType === LEDGER_ENTRY_TYPE.PAYOUT);

    expect(payout).toMatchObject({
      account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
      direction: LEDGER_DIRECTION.DEBIT,
      amount: 1600,
    });
    expect(payout.narration).toMatch(/UTR N123456789012345/);
  });

  /**
   * ⚠️ The leg's amount, never the settlement's total. Writing the settlement
   * figure on a part-payment is how a ledger ends up claiming money went out that
   * is still sitting in our account.
   */
  it("books only what a part-payment carried", async () => {
    const s = await settlement();
    await startPayout(admin(), s._id);
    await PayoutLeg.updateOne(
      { settlementId: s._id, legNumber: 1 },
      { $set: { amount: 1000 } },
    );

    await confirmPayout(admin(), s._id, { utr: "N1" });

    const rows = await ledgerFor(s._id);
    const payouts = rows.filter((r) => r.entryType === LEDGER_ENTRY_TYPE.PAYOUT);
    expect(payouts).toHaveLength(1);
    expect(payouts[0].amount).toBe(1000);
  });

  /**
   * A split payout's first NEFT has genuinely left our account. Waiting for the
   * second leg to book both would leave the books claiming we still hold money
   * that is already gone.
   */
  it("books each leg as it lands, not only at the end", async () => {
    const s = await settlement();
    await startPayout(admin(), s._id);
    await PayoutLeg.updateOne(
      { settlementId: s._id, legNumber: 1 },
      { $set: { amount: 1000 } },
    );
    await confirmPayout(admin(), s._id, { utr: "N1" });

    // Books already reflect the first NEFT, before the settlement is complete.
    expect(
      (await ledgerFor(s._id)).filter((r) => r.entryType === LEDGER_ENTRY_TYPE.PAYOUT),
    ).toHaveLength(1);

    await PayoutLeg.create({
      payoutType: PAYOUT_TYPE.SETTLEMENT,
      settlementId: s._id,
      brandId: BRAND,
      legNumber: 2,
      amount: 600,
      status: PAYOUT_LEG_STATUS.INITIATED,
    });
    await confirmPayout(admin(), s._id, { utr: "N2" });

    const payouts = (await ledgerFor(s._id)).filter(
      (r) => r.entryType === LEDGER_ENTRY_TYPE.PAYOUT,
    );
    expect(payouts).toHaveLength(2);
    expect(payouts.reduce((sum, r) => sum + r.amount, 0)).toBe(1600);
  });

  /**
   * Dated when the money left, not when the confirmation was typed in. An admin
   * entering Friday's UTR on Monday must not move the entry into the following
   * week's reporting.
   */
  it("dates the entry when the money left", async () => {
    const s = await settlement();
    await startPayout(admin(), s._id);
    const paidAt = new Date("2026-08-28T10:00:00Z");

    await confirmPayout(admin(), s._id, { utr: "N1", paidAt });

    const payout = (await ledgerFor(s._id)).find(
      (r) => r.entryType === LEDGER_ENTRY_TYPE.PAYOUT,
    );
    expect(payout.occurredAt.toISOString()).toBe(paidAt.toISOString());
  });

  /**
   * A reserve is money the vendor is owed and we are holding back. Booking it per
   * leg would hold it several times over.
   */
  it("holds a reserve once, on the leg that completes the settlement", async () => {
    const s = await settlement({ reserveHeld: 80, netPayable: 1520 });
    await startPayout(admin(), s._id);
    await confirmPayout(admin(), s._id, { utr: "N1" });

    const reserves = (await ledgerFor(s._id)).filter(
      (r) => r.entryType === LEDGER_ENTRY_TYPE.RESERVE_HOLD,
    );
    expect(reserves).toHaveLength(1);
    expect(reserves[0].amount).toBe(80);
  });

  it("books no reserve row when none is held", async () => {
    const s = await settlement({ reserveHeld: 0 });
    await startPayout(admin(), s._id);
    await confirmPayout(admin(), s._id, { utr: "N1" });

    expect(
      (await ledgerFor(s._id)).filter(
        (r) => r.entryType === LEDGER_ENTRY_TYPE.RESERVE_HOLD,
      ),
    ).toHaveLength(0);
  });
});

describe("a payout is never booked twice", () => {
  /**
   * ⚠️ Keyed on the **leg**, not the settlement. A settlement can pay in several
   * legs, and a settlement-level key would refuse the second leg's entry while
   * the money still left.
   */
  it("refuses a duplicate entry on the same leg", async () => {
    const s = await settlement();
    await startPayout(admin(), s._id);
    await confirmPayout(admin(), s._id, { utr: "N1" });

    const leg = await PayoutLeg.findOne({ settlementId: s._id }).lean();
    const second = await postPayoutEntries({
      leg,
      settlement: await Settlement.findById(s._id).lean(),
      isFinalLeg: true,
    });

    expect(second.posted).toBe(0);
    expect(second.duplicates).toBeGreaterThan(0);
  });

  it("still allows a second leg its own entry", async () => {
    const s = await settlement();
    const settlementDoc = await Settlement.findById(s._id).lean();

    const legA = await PayoutLeg.create({
      payoutType: PAYOUT_TYPE.SETTLEMENT,
      settlementId: s._id,
      brandId: BRAND,
      legNumber: 1,
      amount: 1000,
      status: PAYOUT_LEG_STATUS.PAID,
      paidAt: new Date(),
    });
    const legB = await PayoutLeg.create({
      payoutType: PAYOUT_TYPE.SETTLEMENT,
      settlementId: s._id,
      brandId: BRAND,
      legNumber: 2,
      amount: 600,
      status: PAYOUT_LEG_STATUS.PAID,
      paidAt: new Date(),
    });

    const a = await postPayoutEntries({ leg: legA.toObject(), settlement: settlementDoc });
    const b = await postPayoutEntries({ leg: legB.toObject(), settlement: settlementDoc });

    expect(a.posted).toBe(1);
    expect(b.posted).toBe(1);
  });

  /**
   * The duplicate lookup has to name whichever key the index refused on. A payout
   * row has no `transactionId` at all, so a lookup by type-and-transaction would
   * hand back something else entirely.
   */
  it("hands back the payout row on a duplicate, not some other entry", async () => {
    const s = await settlement();
    const settlementDoc = await Settlement.findById(s._id).lean();
    const leg = await PayoutLeg.create({
      payoutType: PAYOUT_TYPE.SETTLEMENT,
      settlementId: s._id,
      brandId: BRAND,
      legNumber: 1,
      amount: 1600,
      status: PAYOUT_LEG_STATUS.PAID,
      paidAt: new Date(),
    });

    await postPayoutEntries({ leg: leg.toObject(), settlement: settlementDoc });
    const again = await postPayoutEntries({ leg: leg.toObject(), settlement: settlementDoc });

    expect(again.entries[0].entryType).toBe(LEDGER_ENTRY_TYPE.PAYOUT);
    expect(String(again.entries[0].payoutLegId)).toBe(String(leg._id));
  });
});

describe("reversing a payout that came back", () => {
  const paid = async (overrides = {}) => {
    const s = await settlement(overrides);
    await startPayout(admin(), s._id);
    await confirmPayout(admin(), s._id, { utr: "N123" });
    return Settlement.findById(s._id).lean();
  };

  it("credits the payable back", async () => {
    const s = await paid();

    await reversePayout(admin(), s._id, { reason: "Bank recalled the transfer" });

    const reversal = (await ledgerFor(s._id)).find(
      (r) => r.entryType === LEDGER_ENTRY_TYPE.PAYOUT_REVERSAL,
    );
    expect(reversal).toMatchObject({
      account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
      direction: LEDGER_DIRECTION.CREDIT,
      amount: 1600,
    });
  });

  it("needs a reason", async () => {
    const s = await paid();
    await expect(reversePayout(admin(), s._id, {})).rejects.toThrow(
      /say why this payout is being reversed/i,
    );
  });

  /**
   * ⚠️ A crash between the two leaves an over-stated reversal — visible in the
   * ledger, and correctable. The other order leaves rows released with no
   * reversal booked, which reads as money that was never paid and is free to be
   * settled a second time.
   */
  it("writes the reversal before releasing the rows", async () => {
    const s = await paid();
    await Transaction.create({
      purpose: "VOUCHER_CLAIM",
      gatewayAccount: "CUSTOMER",
      customerId: oid(),
      brandId: BRAND,
      amount: 810,
      settlementId: s._id,
    });

    // Observed through the ledger: at the moment the reversal exists, the rows
    // must still be claimed.
    const original = LedgerEntry.create.bind(LedgerEntry);
    let claimedWhenReversalWritten = null;
    LedgerEntry.create = async (doc) => {
      if (doc.entryType === LEDGER_ENTRY_TYPE.PAYOUT_REVERSAL) {
        claimedWhenReversalWritten = await Transaction.countDocuments({
          settlementId: s._id,
        });
      }
      return original(doc);
    };

    try {
      await reversePayout(admin(), s._id, { reason: "Recalled" });
    } finally {
      LedgerEntry.create = original;
    }

    expect(claimedWhenReversalWritten).toBe(1);
    expect(await Transaction.countDocuments({ settlementId: s._id })).toBe(0);
  });

  it("marks the legs reversed too", async () => {
    const s = await paid();
    await reversePayout(admin(), s._id, { reason: "Recalled" });

    const leg = await PayoutLeg.findOne({ settlementId: s._id }).lean();
    // A statement must not show a successful payout next to a settlement that
    // says otherwise.
    expect(leg.status).toBe(PAYOUT_LEG_STATUS.REVERSED);
  });

  /**
   * `PAID` is the only status this can be reached from, so a settlement that
   * never paid cannot produce a spurious reversal and break the ledger's
   * invariants.
   */
  it("cannot reverse a settlement that never paid", async () => {
    const s = await settlement({ status: SETTLEMENT_STATUS.FAILED });

    await expect(
      reversePayout(admin(), s._id, { reason: "nope" }),
    ).rejects.toThrow(/cannot become reversed/i);
  });

  it("books nothing when there are no paid legs", async () => {
    const result = await reversePayoutEntries({
      legs: [],
      settlement: { _id: oid() },
      reason: "x",
    });
    expect(result.posted).toBe(0);
  });
});

describe("the balance tells the truth", () => {
  /**
   * A settlement's whole purpose is to move the vendor's balance to zero for the
   * money it covered. If the payout entry is wrong, that shows up here first —
   * and a month later in a vendor's own arithmetic.
   */
  it("clears what the settlement paid out", async () => {
    const s = await settlement();
    const before = await getVendorBalance(BRAND);

    await startPayout(admin(), s._id);
    await confirmPayout(admin(), s._id, { utr: "N1" });

    const after = await getVendorBalance(BRAND);
    expect(Math.round((before.balance - after.balance) * 100) / 100).toBe(1600);
  });

  it("puts it back on a reversal", async () => {
    const s = await settlement();
    await startPayout(admin(), s._id);
    await confirmPayout(admin(), s._id, { utr: "N1" });
    const afterPayout = await getVendorBalance(BRAND);

    await reversePayout(admin(), s._id, { reason: "Recalled" });

    const afterReversal = await getVendorBalance(BRAND);
    expect(
      Math.round((afterReversal.balance - afterPayout.balance) * 100) / 100,
    ).toBe(1600);
  });
});
