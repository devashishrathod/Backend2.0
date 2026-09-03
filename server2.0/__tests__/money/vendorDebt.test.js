/**
 * The debt no settlement cycle can reach.
 *
 * ### ⚠️ Why this file exists
 *
 * A brand whose deductions outrun their takings builds a settlement with a
 * negative `netPayable`. That goes `CARRIED_FORWARD`, and carrying forward **is**
 * releasing every claim it held — deliberately, so the debt and the takings both
 * flow into the next cycle. While the brand still trades, new sales net it off
 * and the loop ends by itself.
 *
 * The day they stop trading it never does. The same rows are claimed and released
 * every cycle, for ever. Nothing throws, no status is wrong, no figure is
 * inconsistent — the money simply sits on our books as a receivable from somebody
 * who is not coming back, and no report anywhere says so.
 *
 * Two things were missing and are tested here: somebody being **told** (the
 * vendor at the cycle that paid them nothing, the admin at the debt that has
 * stopped moving), and somebody being able to **close it** without the write-off
 * being silently re-claimed by the next build.
 */
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
const Dispute = require("../../models/Dispute");
const RefundRequest = require("../../models/RefundRequest");
const Settlement = require("../../models/Settlement");
const SettlementHistory = require("../../models/SettlementHistory");
const LedgerEntry = require("../../models/LedgerEntry");
const Setting = require("../../models/Setting");
const Brand = require("../../models/Brand");

const { postChargebackLoss } = require("../../helpers/ledger");
const { generateBrandMerchantId } = require("../../helpers/brands");
const {
  computeVendorDebt,
  brandsWithAgedDebt,
  claimChargebackAdjustments,
  claimRefundAdjustments,
} = require("../../helpers/settlements");
const {
  writeOffVendorDebt,
  getVendorDebt,
  alertVendorDebt,
} = require("../../services/settlements");

const {
  LEDGER_ENTRY_TYPE,
  LEDGER_ACCOUNT,
  LEDGER_DIRECTION,
} = require("../../constants/ledger");
const { DISPUTE_STATUS } = require("../../constants/webhook");
const {
  REFUND_REQUEST_STATUS,
  REFUND_REASON,
} = require("../../constants/refund");
const { NOTIFICATION_TYPES } = require("../../constants/notification");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");
const { PAYMENT_STATUS, ROLES } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

let BRAND;
let seq = 0;

const admin = () => ({ role: ROLES.ADMIN, userId: oid() });

/** ₹811.80 in, netBill 800, promo 15 → the vendor's share is ₹785. */
const VENDOR_SHARE = 785;

const payment = async ({ settled = true, ...fields } = {}) =>
  Transaction.create({
    purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
    gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
    customerId: oid(),
    brandId: BRAND,
    amount: 811.8,
    paidAmount: 811.8,
    status: PAYMENT_STATUS.CAPTURED,
    verified: true,
    verifiedAt: ago(120 * DAY),
    fundsReceivedAt: ago(119 * DAY),
    invoiceId: `TD/VCH/26-27/${String(++seq).padStart(6, "0")}`,
    ...(settled ? { settlementId: oid() } : {}),
    voucher: {
      claimId: oid(),
      netBill: 800,
      vendorPayable: 800,
      vendorPromoCost: 15,
      commissionAmount: 0,
    },
    ...fields,
  });

/** A chargeback the bank ruled against us, with the ledger row that always comes with it. */
const lostDispute = async (transaction, { at = ago(120 * DAY) } = {}) => {
  const disputeId = `disp_${Math.random().toString(36).slice(2, 12)}`;
  await Dispute.create({
    disputeId,
    transactionId: transaction._id,
    brandId: transaction.brandId,
    status: DISPUTE_STATUS.LOST,
    amount: 811.8,
    resolvedAt: at,
    lastEventAt: at,
  });
  await postChargebackLoss({ transaction, disputeId });
  return disputeId;
};

const completedRefund = async (transaction, { clawback = 300, at } = {}) =>
  RefundRequest.create({
    transactionId: transaction._id,
    brandId: transaction.brandId,
    customerId: transaction.customerId,
    claimId: transaction.voucher.claimId,
    reason: REFUND_REASON.NOT_HONOURED,
    status: REFUND_REQUEST_STATUS.COMPLETED,
    requestedAmount: clawback,
    approvedAmount: clawback,
    completedAt: at || ago(120 * DAY),
    split: { totalRefund: clawback, vendorClawback: clawback },
  });

/**
 * Brands only exist here so the admin alert can name one.
 *
 * ⚠️ `generateBrandMerchantId`, not a plausible-looking string: `merchantId`
 * carries an HMAC from `MERCHANT_ID_SECRET`, so anything invented fails
 * validation — and the real generator stays correct if the format ever changes.
 */
const seedBrand = async (brandName = "Chai Point") =>
  Brand.create({
    _id: BRAND,
    userId: oid(),
    brandName,
    merchantId: await generateBrandMerchantId(),
    uniqueId: `TDB${Date.now()}${Math.floor(Math.random() * 1000)}`,
    isDeleted: false,
  });

const balanceOf = async (account) => {
  const rows = await LedgerEntry.find({ account, isDeleted: false }).lean();
  return r2(
    rows.reduce(
      (s, r) => s + (r.direction === LEDGER_DIRECTION.CREDIT ? r.amount : -r.amount),
      0,
    ),
  );
};

const COLLECTIONS = [
  Transaction,
  Dispute,
  RefundRequest,
  Settlement,
  SettlementHistory,
  LedgerEntry,
  Setting,
  Brand,
];

beforeAll(async () => {
  await connectTestDb();
  for (const m of [Transaction, Dispute, RefundRequest, LedgerEntry, Settlement]) {
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
  mockNotify.mockClear();
});

describe("what a brand actually owes", () => {
  it("counts a lost chargeback on a payment the vendor was paid for", async () => {
    await lostDispute(await payment());

    const debt = await computeVendorDebt({ brandId: BRAND });

    expect(debt.outstanding).toBe(VENDOR_SHARE);
    expect(debt.counts).toEqual({ refunds: 0, disputes: 1 });
  });

  it("counts a completed refund's clawback beside it", async () => {
    const txn = await payment();
    await completedRefund(txn, { clawback: 200 });
    await lostDispute(await payment());

    const debt = await computeVendorDebt({ brandId: BRAND });

    expect(debt.outstanding).toBe(r2(VENDOR_SHARE + 200));
    expect(debt.counts).toEqual({ refunds: 1, disputes: 1 });
  });

  /**
   * ⚠️ The single most important exclusion.
   *
   * If the payment never reached the vendor, `settlementHold` kept that money
   * out of every cycle — **we still hold it**. Counting it as a debt invents a
   * receivable, and writing it off would book a platform cost for money the
   * platform never lost.
   */
  it("is not a debt when the vendor was never paid for that sale", async () => {
    await lostDispute(await payment({ settled: false }));

    const debt = await computeVendorDebt({ brandId: BRAND });

    expect(debt.outstanding).toBe(0);
    expect(debt.disputes).toEqual([]);
  });

  /** Already recovered by a cycle. Reporting it again would double it. */
  it("ignores a chargeback a settlement has already claimed", async () => {
    const disputeId = await lostDispute(await payment());
    await Dispute.updateOne(
      { disputeId },
      { $set: { recoverySettlementId: oid() } },
    );

    const debt = await computeVendorDebt({ brandId: BRAND });

    expect(debt.outstanding).toBe(0);
  });

  /**
   * ⚠️ Valued at what the **ledger booked**, never recomputed from `voucher`.
   *
   * `postChargebackLoss` caps each loss against what the payment has already
   * given up, so a second dispute on the same payment can only take the headroom
   * left. Recomputing would report — and then write off — money never lost.
   */
  it("never reports more than the ledger booked, however many disputes there are", async () => {
    const txn = await payment();
    await lostDispute(txn);
    await lostDispute(txn);

    const debt = await computeVendorDebt({ brandId: BRAND });

    expect(debt.outstanding).toBe(VENDOR_SHARE);
    expect(debt.counts.disputes).toBe(1);
  });

  it("ages from the oldest unrecovered item", async () => {
    await lostDispute(await payment(), { at: ago(200 * DAY) });
    await completedRefund(await payment(), { at: ago(10 * DAY) });

    const debt = await computeVendorDebt({ brandId: BRAND });

    expect(debt.ageDays).toBeGreaterThanOrEqual(199);
    expect(debt.ageDays).toBeLessThanOrEqual(201);
  });

  it("says nothing is owed when nothing is", async () => {
    const debt = await computeVendorDebt({ brandId: BRAND });

    expect(debt).toMatchObject({ outstanding: 0, oldestAt: null });
  });
});

describe("finding the brands that have stopped moving", () => {
  it("lists a brand whose debt is older than the cutoff", async () => {
    await lostDispute(await payment(), { at: ago(120 * DAY) });

    const brands = await brandsWithAgedDebt({ olderThanDays: 90 });

    expect(brands.map(String)).toContain(String(BRAND));
  });

  it("leaves a recent one alone", async () => {
    await lostDispute(await payment(), { at: ago(10 * DAY) });

    const brands = await brandsWithAgedDebt({ olderThanDays: 90 });

    expect(brands.map(String)).not.toContain(String(BRAND));
  });

  it("does not list one whose debt has been written off", async () => {
    await lostDispute(await payment(), { at: ago(120 * DAY) });
    await Dispute.updateMany({ brandId: BRAND }, { $set: { writtenOffAt: new Date() } });

    const brands = await brandsWithAgedDebt({ olderThanDays: 90 });

    expect(brands.map(String)).not.toContain(String(BRAND));
  });
});

describe("telling the admin", () => {
  beforeEach(async () => {
    await seedBrand();
  });

  it("alerts once for a brand whose debt has aged past the write-off mark", async () => {
    await lostDispute(await payment(), { at: ago(120 * DAY) });

    /**
     * ⚠️ `console.error` is part of the assertion, and it is not fussiness.
     *
     * `sendQuietly` takes a **thunk** and calls it inside its own try/catch.
     * Handing it an already-invoked promise looks identical from here — the
     * mock still records the call, so this test passed while the guard was
     * gone — and the difference only shows up the day a delivery fails, as an
     * unhandled rejection that takes the job runner with it.
     *
     * The wrapper logs `[notify] … failed:` on any such slip, so watching for a
     * silent run is what actually pins the shape.
     */
    const logged = jest.spyOn(console, "error").mockImplementation(() => {});

    const result = await alertVendorDebt();

    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();

    expect(result).toMatchObject({ alerted: 1, outstanding: VENDOR_SHARE });
    const alert = mockNotify.mock.calls.find(
      ([a]) => a.type === NOTIFICATION_TYPES.VENDOR_DEBT_AGED,
    );
    expect(alert).toBeDefined();
    expect(alert[0].title).toContain("Chai Point");
    expect(alert[0].meta).toMatchObject({ outstanding: VENDOR_SHARE });
  });

  /**
   * The shortlist asks *"is there an old unclaimed row?"*; the figure asks *"is
   * any money actually owed?"* Alerting on the first alone would send an admin
   * to write off a balance of zero.
   */
  it("stays quiet when the aged rows add up to nothing recoverable", async () => {
    await lostDispute(await payment({ settled: false }), { at: ago(120 * DAY) });

    const result = await alertVendorDebt();

    expect(result).toMatchObject({ checked: 1, alerted: 0, outstanding: 0 });
    expect(
      mockNotify.mock.calls.some(
        ([a]) => a.type === NOTIFICATION_TYPES.VENDOR_DEBT_AGED,
      ),
    ).toBe(false);
  });

  it("does not alert on a debt that is still young", async () => {
    await lostDispute(await payment(), { at: ago(10 * DAY) });

    const result = await alertVendorDebt();

    expect(result).toMatchObject({ checked: 0, alerted: 0 });
  });
});

describe("writing it off", () => {
  it("is admin only", async () => {
    await expect(
      writeOffVendorDebt(
        { role: ROLES.VENDOR, brandId: BRAND, userId: oid() },
        { brandId: BRAND, reason: "gone" },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    await expect(
      getVendorDebt({ role: ROLES.VENDOR, brandId: BRAND }, BRAND),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  /** The ledger is never edited; an unexplained adjustment reads as a mistake. */
  it("refuses without a written reason", async () => {
    await expect(
      writeOffVendorDebt(admin(), { brandId: BRAND, reason: " " }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it("says so plainly when there is nothing outstanding", async () => {
    const result = await writeOffVendorDebt(admin(), {
      brandId: BRAND,
      reason: "closing the account",
    });

    expect(result).toMatchObject({ writtenOff: 0 });
    expect(result.message).toMatch(/nothing outstanding/i);
  });

  /**
   * ⚠️ Both sides, and only both.
   *
   * The credit returns the vendor's balance to zero so no future cycle sees a
   * debt. The debit records that **we** absorbed it — without it the loss
   * vanishes from the books entirely and *"what did chargebacks cost us"* has no
   * answer.
   */
  it("credits the vendor and charges the platform, for the same amount", async () => {
    await lostDispute(await payment());

    const before = await balanceOf(LEDGER_ACCOUNT.VENDOR_PAYABLE);
    const result = await writeOffVendorDebt(admin(), {
      brandId: BRAND,
      reason: "Outlet closed; no future settlements to recover from",
    });

    expect(result.writtenOff).toBe(VENDOR_SHARE);
    expect(await balanceOf(LEDGER_ACCOUNT.VENDOR_PAYABLE)).toBe(
      r2(before + VENDOR_SHARE),
    );

    const cost = await LedgerEntry.find({
      entryType: LEDGER_ENTRY_TYPE.MANUAL_ADJUSTMENT,
      account: LEDGER_ACCOUNT.PLATFORM_COST,
      isDeleted: false,
    }).lean();
    expect(cost).toHaveLength(1);
    expect(cost[0].amount).toBe(VENDOR_SHARE);
    expect(cost[0].direction).toBe(LEDGER_DIRECTION.DEBIT);
    expect(cost[0].reason).toContain("Outlet closed");
  });

  it("marks the rows so they carry who decided and why", async () => {
    const actor = admin();
    await lostDispute(await payment());
    await completedRefund(await payment(), { clawback: 120 });

    await writeOffVendorDebt(actor, {
      brandId: BRAND,
      reason: "Brand off the platform since March",
    });

    const dispute = await Dispute.findOne({ brandId: BRAND }).lean();
    const refund = await RefundRequest.findOne({ brandId: BRAND }).lean();

    expect(dispute.writtenOffAt).toBeInstanceOf(Date);
    expect(String(dispute.writtenOffBy)).toBe(String(actor.userId));
    expect(refund.writtenOffReason).toContain("off the platform");
  });

  /**
   * ⚠️ The whole point.
   *
   * Without the `writtenOffAt: null` in both claim filters the write-off is
   * cosmetic: the next build re-claims the row, deducts it again, nets negative
   * again and releases it again — the same endless loop, now with a
   * `MANUAL_ADJUSTMENT` in the ledger insisting we had already absorbed it. The
   * books would carry the loss twice.
   */
  it("takes the rows out of every future settlement claim", async () => {
    await lostDispute(await payment());
    await completedRefund(await payment(), { clawback: 120 });

    await writeOffVendorDebt(admin(), {
      brandId: BRAND,
      reason: "Not recoverable",
    });

    const settlementId = oid();
    const claimedDisputes = await claimChargebackAdjustments({
      settlementId,
      brandId: BRAND,
    });
    const claimedRefunds = await claimRefundAdjustments({
      settlementId,
      brandId: BRAND,
    });

    expect(claimedDisputes).toEqual([]);
    expect(claimedRefunds).toEqual([]);
  });

  /**
   * ⚠️ Running it twice must not double the platform's recorded loss.
   *
   * The vendor side is idempotent by index (`ONCE_PER_DISPUTE`), but the cost
   * side carries no reference and nothing stops a second row — so the pair is
   * written together and the cost side is skipped whenever the vendor side
   * reports it was already there.
   */
  it("absorbs the loss exactly once when run twice", async () => {
    await lostDispute(await payment());

    await writeOffVendorDebt(admin(), { brandId: BRAND, reason: "Not recoverable" });
    const second = await writeOffVendorDebt(admin(), {
      brandId: BRAND,
      reason: "Not recoverable",
    });

    expect(second.writtenOff).toBe(0);
    expect(await balanceOf(LEDGER_ACCOUNT.PLATFORM_COST)).toBe(-VENDOR_SHARE);
  });

  /**
   * *"Write off everything older than 90 days"* is the real request far more
   * often than *"write off everything"* — a brand still trading may carry one
   * ancient chargeback beside a refund the next cycle will collect on its own.
   */
  it("can write off only what is older than a given age", async () => {
    await lostDispute(await payment(), { at: ago(200 * DAY) });
    await completedRefund(await payment(), { clawback: 120, at: ago(5 * DAY) });

    const result = await writeOffVendorDebt(admin(), {
      brandId: BRAND,
      reason: "Ancient chargeback, brand still trading",
      olderThanDays: 90,
    });

    expect(result.writtenOff).toBe(VENDOR_SHARE);
    expect(result.rows).toEqual({ disputes: 1, refunds: 0 });

    const stillOwed = await computeVendorDebt({ brandId: BRAND });
    expect(stillOwed.outstanding).toBe(120);
  });

  it("leaves everything alone when nothing is old enough", async () => {
    await lostDispute(await payment(), { at: ago(5 * DAY) });

    const result = await writeOffVendorDebt(admin(), {
      brandId: BRAND,
      reason: "too soon",
      olderThanDays: 90,
    });

    expect(result.writtenOff).toBe(0);
    expect(
      await LedgerEntry.countDocuments({
        entryType: LEDGER_ENTRY_TYPE.MANUAL_ADJUSTMENT,
      }),
    ).toBe(0);
  });

  /**
   * A brand back in the black stops being alerted about, without anybody
   * touching the sweep.
   */
  it("stops the aged-debt alert firing for that brand", async () => {
    await seedBrand();
    await lostDispute(await payment(), { at: ago(120 * DAY) });

    await writeOffVendorDebt(admin(), { brandId: BRAND, reason: "Not recoverable" });
    const result = await alertVendorDebt();

    expect(result.alerted).toBe(0);
  });
});
