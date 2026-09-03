const mongoose = require("mongoose");

const mockNotify = jest.fn(async () => ({ delivered: true }));
jest.mock("../../helpers/notifications/notify", () => ({
  notify: (...args) => mockNotify(...args),
  resolveRecipient: jest.fn(),
}));

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const RefundRequest = require("../../models/RefundRequest");
const VoucherClaim = require("../../models/VoucherClaim");
const VoucherUsage = require("../../models/VoucherUsage");
const VoucherClaimHistory = require("../../models/VoucherClaimHistory");
const Settlement = require("../../models/Settlement");
const SettlementHistory = require("../../models/SettlementHistory");
const PayoutLeg = require("../../models/PayoutLeg");
const LedgerEntry = require("../../models/LedgerEntry");
const Setting = require("../../models/Setting");
const Brand = require("../../models/Brand");
const Bank = require("../../models/Bank");

const { postCaptureEntries } = require("../../helpers/ledger");
const { applyRefundCompletion } = require("../../helpers/refunds");
const {
  buildSettlements,
  startPayout,
  confirmPayout,
  failPayout,
  reversePayout,
  writeOffVendorDebt,
} = require("../../services/settlements");
const { generateBrandMerchantId } = require("../../helpers/brands");
const { SETTLEMENT_STATUS } = require("../../constants/settlement");
const {
  LEDGER_ACCOUNT,
  LEDGER_DIRECTION,
  LEDGER_ENTRY_TYPE,
} = require("../../constants/ledger");
const { REFUND_REQUEST_STATUS, REFUND_REASON } = require("../../constants/refund");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
  GATEWAY_FEE_BEARER,
} = require("../../constants/transaction");
const { PAYMENT_STATUS, ROLES } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Every rupee, in every ending a payment can have.
 *
 * ### The one question this file asks
 *
 * For any claim, at any point:
 *
 * ```
 * what the vendor has been paid  +  what the vendor is still owed
 *     ===  their share of the sale  −  their share of anything refunded
 * ```
 *
 * That is the whole contract. Every scenario below drives the real services to
 * a different ending — settled, refunded in full, refunded in part, refunded
 * after payout, bounced, reversed — and checks that identity holds to the paisa.
 *
 * ### Why an identity rather than a list of expected numbers
 *
 * Expected-value assertions only catch the arithmetic somebody thought about.
 * The defects in this subsystem were all in the arithmetic nobody added up: a
 * promo share reversed twice, a clawback deducted for a sale the vendor was
 * never paid for, a leg recording a figure no bank transfer carried. Each of
 * those was individually plausible and collectively wrong, and each is caught
 * here by the same line.
 */

let BRAND;
let BANK_ID;
let seq = 0;

const admin = () => ({ role: ROLES.ADMIN, userId: oid() });

/** bill 1000, offer 200, promo 50 split 15/35, fee 10 + 1.80 GST on top. */
const PRICING = Object.freeze({
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
  taxOnTop: 1.8,
  taxType: "GST_18",
  commissionAmount: 0,
  totalPayable: 761.8,
});

const GATEWAY_FEE = 17.94;

/** What the vendor is entitled to from one clean sale. */
const VENDOR_SHARE = r2(PRICING.netBill - PRICING.vendorPromoCost);

const seedBank = async () => {
  const bank = await Bank.create({
    brandId: BRAND,
    accountHolderName: "Cafe Mocha",
    accountNumber: `1234567${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`,
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
};

/** A captured payment with its capture-time ledger rows already booked. */
const sale = async (overrides = {}) => {
  const claimId = oid();
  const txn = await Transaction.create({
    purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
    gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
    customerId: oid(),
    brandId: BRAND,
    amount: PRICING.totalPayable,
    paidAmount: PRICING.totalPayable,
    status: PAYMENT_STATUS.CAPTURED,
    verified: true,
    verifiedAt: ago(5 * DAY),
    fundsReceivedAt: ago(4 * DAY),
    settlementHold: false,
    amountRefunded: 0,
    gatewayFee: GATEWAY_FEE,
    gatewayFeeBearer: GATEWAY_FEE_BEARER.PLATFORM,
    invoiceId: `TD/VCH/26-27/${Math.floor(Math.random() * 1e6)}`,
    voucher: {
      claimId,
      billAmount: PRICING.billAmount,
      netBill: PRICING.netBill,
      vendorPayable: PRICING.netBill,
      vendorPromoCost: PRICING.vendorPromoCost,
      platformPromoCost: PRICING.platformPromoCost,
      commissionAmount: 0,
    },
    ...overrides,
  });

  const claim = { _id: claimId, brandId: BRAND, claimCode: `TD-INV${++seq}`, pricing: PRICING };
  await postCaptureEntries({ transaction: txn, claim, pricing: PRICING });
  return { txn, claim };
};

const refund = async ({ txn, claim }, { total, clawback, promoReversal }) => {
  const request = await RefundRequest.create({
    claimId: claim._id,
    transactionId: txn._id,
    customerId: txn.customerId,
    brandId: BRAND,
    claimCode: claim.claimCode,
    requestedAmount: total,
    approvedAmount: total,
    reason: REFUND_REASON.OTHER,
    status: REFUND_REQUEST_STATUS.PROCESSING,
    split: {
      totalRefund: total,
      vendorClawback: clawback,
      vendorPromoReversal: promoReversal,
      netBillRefund: r2(clawback + promoReversal),
    },
  });

  await applyRefundCompletion({
    refundRequest: request,
    gatewayTotalRefunded: total,
  });
  return request;
};

/** Sum of every ledger row, per account. CREDIT adds, DEBIT subtracts. */
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

/** What has actually left our bank for this brand, per the ledger. */
const vendorPaid = async () => {
  const rows = await LedgerEntry.find({
    entryType: LEDGER_ENTRY_TYPE.PAYOUT,
    isDeleted: false,
  }).lean();
  const reversals = await LedgerEntry.find({
    entryType: LEDGER_ENTRY_TYPE.PAYOUT_REVERSAL,
    isDeleted: false,
  }).lean();
  return r2(
    rows.reduce((s, r) => s + r.amount, 0) -
      reversals.reduce((s, r) => s + r.amount, 0),
  );
};

/**
 * ⚠️ The identity. Everything in this file reduces to this line.
 *
 * `stillOwed` is the ledger's `VENDOR_PAYABLE`; `paid` is what payout entries
 * say actually left. Together they must equal the vendor's entitlement — their
 * share of the sale, less their share of whatever went back to the customer.
 */
const assertVendorWhole = async (expectedEntitlement, note) => {
  const books = await balances();
  const stillOwed = books[LEDGER_ACCOUNT.VENDOR_PAYABLE] || 0;
  const paid = await vendorPaid();

  expect({
    note,
    total: r2(stillOwed + paid),
  }).toEqual({ note, total: r2(expectedEntitlement) });
};

const settle = async () => {
  await buildSettlements();
  return Settlement.findOne({ brandId: BRAND, isDeleted: false })
    .sort({ createdAt: -1 })
    .lean();
};

const approve = async (settlementId) =>
  Settlement.updateOne(
    { _id: settlementId },
    { $set: { status: SETTLEMENT_STATUS.APPROVED } },
  );

const COLLECTIONS = [
  Transaction,
  RefundRequest,
  VoucherClaim,
  VoucherUsage,
  VoucherClaimHistory,
  Settlement,
  SettlementHistory,
  PayoutLeg,
  LedgerEntry,
  Setting,
  Brand,
  Bank,
];

beforeAll(async () => {
  await connectTestDb();
  for (const m of [Transaction, RefundRequest, Settlement, PayoutLeg, LedgerEntry, Brand, Bank]) {
    await m.createIndexes();
  }
});

afterAll(async () => {
  await clearCollections(...COLLECTIONS);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(...COLLECTIONS);
  BRAND = oid();
  BANK_ID = null;
  mockNotify.mockClear();
  await seedBank();
});

describe("a sale that is simply paid out", () => {
  it("pays the vendor their whole share and owes nothing after", async () => {
    await sale();

    const s = await settle();
    expect(s.netPayable).toBe(VENDOR_SHARE);

    await approve(s._id);
    await startPayout(admin(), s._id);
    await confirmPayout(admin(), s._id, { utr: "N100000000000001" });

    expect(await vendorPaid()).toBe(VENDOR_SHARE);
    await assertVendorWhole(VENDOR_SHARE, "clean sale, paid in full");

    const books = await balances();
    expect(books[LEDGER_ACCOUNT.VENDOR_PAYABLE] || 0).toBe(0);
  });
});

describe("a sale refunded in full before it is ever paid out", () => {
  it("leaves the vendor owed nothing and paid nothing", async () => {
    const s1 = await sale();

    await refund(s1, {
      total: PRICING.totalPayable,
      clawback: VENDOR_SHARE,
      promoReversal: PRICING.vendorPromoCost,
    });

    const built = await buildSettlements();
    expect(built.built).toBe(0);

    expect(await vendorPaid()).toBe(0);
    await assertVendorWhole(0, "full refund before payout");
  });

  /**
   * ⚠️ And the clawback must not be taken out of a *different* sale. The vendor
   * was never paid for this one, so there is nothing to claw.
   */
  it("does not dock an unrelated sale for it", async () => {
    const good = await sale();
    const bad = await sale();

    await refund(bad, {
      total: PRICING.totalPayable,
      clawback: VENDOR_SHARE,
      promoReversal: PRICING.vendorPromoCost,
    });

    const s = await settle();

    expect(s.transactionCount).toBe(1);
    expect(s.refundAdjustment).toBe(0);
    expect(s.netPayable).toBe(VENDOR_SHARE);
    expect(String(good.txn.brandId)).toBe(String(BRAND));
  });
});

describe("a sale refunded in part before it is paid out", () => {
  const CLAWBACK = 296.3;
  const PROMO_BACK = 5.55;

  it("pays the vendor their share less the clawback, and no more", async () => {
    const s1 = await sale();

    await refund(s1, {
      total: 300,
      clawback: CLAWBACK,
      promoReversal: PROMO_BACK,
    });

    const s = await settle();
    expect(s.refundAdjustment).toBe(CLAWBACK);
    expect(s.netPayable).toBe(r2(VENDOR_SHARE - CLAWBACK));

    await approve(s._id);
    await startPayout(admin(), s._id);
    await confirmPayout(admin(), s._id, { utr: "N100000000000001" });

    expect(await vendorPaid()).toBe(r2(VENDOR_SHARE - CLAWBACK));
  });

  /**
   * ⚠️ The regression that cost the most. The payment used to be excluded from
   * every future cycle *and* have its clawback deducted elsewhere — the vendor
   * lost the sale and paid the refund, roughly ₹1,100 on an ₹800 sale.
   */
  it("never docks the vendor twice for one refund", async () => {
    const s1 = await sale();
    await refund(s1, { total: 300, clawback: CLAWBACK, promoReversal: PROMO_BACK });

    const s = await settle();
    await approve(s._id);
    await startPayout(admin(), s._id);
    await confirmPayout(admin(), s._id, { utr: "N100000000000001" });

    // Another cycle, with nothing new — the clawback must not reappear.
    await Settlement.updateOne(
      { _id: s._id },
      { $set: { idempotencyKey: `STL:VOID:${s._id}` } },
    );
    const second = await buildSettlements();
    expect(second.built).toBe(0);

    expect(await vendorPaid()).toBe(r2(VENDOR_SHARE - CLAWBACK));
  });
});

describe("a sale refunded after the vendor was already paid", () => {
  const CLAWBACK = 296.3;
  const PROMO_BACK = 5.55;

  /**
   * The carry-back case. The vendor keeps the money from cycle one, and cycle
   * two is reduced by the clawback — which is the only honest way to do it once
   * the money has gone.
   */
  it("takes the clawback out of the next cycle, exactly once", async () => {
    const first = await sale();

    const s1 = await settle();
    await approve(s1._id);
    await startPayout(admin(), s1._id);
    await confirmPayout(admin(), s1._id, { utr: "N100000000000001" });
    expect(await vendorPaid()).toBe(VENDOR_SHARE);

    // Refunded after payout.
    await refund(first, { total: 300, clawback: CLAWBACK, promoReversal: PROMO_BACK });

    // A fresh sale funds the next cycle.
    await sale();
    await Settlement.updateOne(
      { _id: s1._id },
      { $set: { idempotencyKey: `STL:VOID:${s1._id}` } },
    );

    const s2 = await settle();
    expect(s2.refundAdjustment).toBe(CLAWBACK);
    expect(s2.netPayable).toBe(r2(VENDOR_SHARE - CLAWBACK));

    await approve(s2._id);
    await startPayout(admin(), s2._id);
    await confirmPayout(admin(), s2._id, { utr: "N100000000000002" });

    // Two sales, one partial refund: the vendor keeps both shares less one clawback.
    expect(await vendorPaid()).toBe(r2(2 * VENDOR_SHARE - CLAWBACK));
  });
});

/**
 * ⚠️ A write-off is the one thing that deliberately breaks the plain identity —
 * and the extended one is what makes it honest.
 *
 * `stillOwed + paid === entitlement` describes a world where every debt is
 * eventually collected. Forgiving one takes money out of the vendor's column and
 * puts it nowhere, so the identity has to grow a third term:
 *
 *     what they are still owed  +  what we paid them  +  what we forgave
 *         ===  their share of the sale  −  their share of anything refunded
 *
 * If the `PLATFORM_COST` side were ever dropped — and it very nearly was, because
 * `ONCE_PER_REFUND` would have made it a duplicate-key no-op had the reference
 * gone on both rows — this is the assertion that catches it: the vendor's debt
 * would clear, the platform's cost would never appear, and the books would be
 * short by exactly the amount forgiven.
 */
describe("a debt we decide not to chase", () => {
  it("moves the loss from the vendor's column to ours, and nowhere else", async () => {
    const first = await sale();

    const s1 = await settle();
    await approve(s1._id);
    await startPayout(admin(), s1._id);
    await confirmPayout(admin(), s1._id, { utr: "N100000000000009" });

    // Refunded after payout, so the clawback has nowhere to come from.
    await refund(first, { total: 300, clawback: 296.3, promoReversal: 5.55 });

    /**
     * The clawback only. `vendorPromoReversal` hands back part of what the
     * vendor had contributed to the promo, so it does not reduce what they are
     * owed — the same figure the carry-back case above pins.
     */
    const entitlement = r2(VENDOR_SHARE - 296.3);
    await assertVendorWhole(entitlement, "clawback owed, brand stops trading");

    const forgiven = await writeOffVendorDebt(
      admin(),
      { brandId: BRAND, reason: "Outlet closed; nothing left to recover from" },
    );
    expect(forgiven.writtenOff).toBe(296.3);

    /**
     * ⚠️ The plain identity is now short by exactly what we forgave — that is
     * the write-off working, not a defect. Asserted explicitly so nobody later
     * "fixes" it by dropping the platform-cost row.
     */
    const books = await balances();
    const stillOwed = books[LEDGER_ACCOUNT.VENDOR_PAYABLE] || 0;
    const paid = await vendorPaid();

    expect(r2(stillOwed + paid)).toBe(r2(entitlement + 296.3));
    expect(r2(stillOwed + paid - forgiven.writtenOff)).toBe(entitlement);
  });
});

describe("a payout that does not land", () => {
  it("books nothing when the bank bounces it", async () => {
    await sale();
    const s = await settle();
    await approve(s._id);
    await startPayout(admin(), s._id);

    await failPayout(admin(), s._id, { note: "account closed" });

    expect(await vendorPaid()).toBe(0);
    await assertVendorWhole(VENDOR_SHARE, "bounced payout — still owed in full");
  });

  /**
   * A reversal has to put the vendor back exactly where they were, or the next
   * cycle pays a figure that already went out.
   */
  it("puts the money back when a paid payout is reversed", async () => {
    await sale();
    const s = await settle();
    await approve(s._id);
    await startPayout(admin(), s._id);
    await confirmPayout(admin(), s._id, { utr: "N100000000000001" });

    expect(await vendorPaid()).toBe(VENDOR_SHARE);

    await reversePayout(admin(), s._id, { reason: "bank pulled it back" });

    expect(await vendorPaid()).toBe(0);
    await assertVendorWhole(VENDOR_SHARE, "reversed payout — owed again");
  });
});

describe("a payout that goes out in two transfers", () => {
  it("adds up to exactly the payable, never more", async () => {
    await sale();
    const s = await settle();
    await approve(s._id);

    await startPayout(admin(), s._id);
    await confirmPayout(admin(), s._id, { utr: "N1", amount: 300 });

    await startPayout(admin(), s._id);
    await confirmPayout(admin(), s._id, { utr: "N2" });

    expect(await vendorPaid()).toBe(VENDOR_SHARE);
    await assertVendorWhole(VENDOR_SHARE, "split payout");

    const legs = await PayoutLeg.find({ settlementId: s._id }).sort({ legNumber: 1 }).lean();
    expect(legs.map((l) => l.amount)).toEqual([300, r2(VENDOR_SHARE - 300)]);
  });
});

describe("two partial refunds that together close the sale", () => {
  it("ends with the vendor owed and paid nothing", async () => {
    const s1 = await sale();

    await refund(s1, { total: 300, clawback: 296.3, promoReversal: 5.55 });
    await refund(s1, {
      total: PRICING.totalPayable,
      clawback: r2(VENDOR_SHARE - 296.3),
      promoReversal: r2(PRICING.vendorPromoCost - 5.55),
    });

    const built = await buildSettlements();
    expect(built.built).toBe(0);

    expect(await vendorPaid()).toBe(0);
    await assertVendorWhole(0, "two partials adding to a full refund");
  });
});
