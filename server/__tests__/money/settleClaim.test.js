const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const VoucherClaim = require("../../models/VoucherClaim");
const VoucherClaimHistory = require("../../models/VoucherClaimHistory");
const VoucherUsage = require("../../models/VoucherUsage");
const LedgerEntry = require("../../models/LedgerEntry");
const PromoCode = require("../../models/PromoCode");
const PromoCodeUsage = require("../../models/PromoCodeUsage");
const Notification = require("../../models/Notification");
const User = require("../../models/User");

const {
  settleVoucherClaimPayment,
} = require("../../helpers/voucherClaims");
const { getVendorBalance } = require("../../helpers/ledger");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
  SETTLEMENT_STAGE,
  GATEWAY_FEE_BEARER,
} = require("../../constants/transaction");
const {
  VOUCHER_CLAIM_STATUS,
  CLAIM_HISTORY_ACTION,
  CLAIM_REDEMPTION_MODE,
  DEFAULT_REDEMPTION_MODE,
  isImplementedRedemptionMode,
} = require("../../constants/voucherClaim");
const { NOTIFICATION_SEVERITY } = require("../../constants/notification");
const { ROLES } = require("../../constants");
const { LEDGER_ENTRY_TYPE } = require("../../constants/ledger");

const oid = () => new mongoose.Types.ObjectId();

/** The plan's worked example. */
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
  amountInPaise: 76000,
  youSaved: 250,
  vendorPayable: 785,
};

/** A captured Razorpay payment, as the webhook delivers it. */
const capturedPayment = (overrides = {}) => ({
  id: `pay_TEST${Date.now()}${Math.floor(Math.random() * 1000)}`,
  entity: "payment",
  captured: true,
  status: "captured",
  amount: 76000,
  method: "upi",
  // Razorpay's MDR. `fee` is the TOTAL and already contains `tax`.
  fee: 1794,
  tax: 274,
  created_at: 1756500000,
  ...overrides,
});

/** Build a claim + its transaction, as `createVoucherClaimOrder` leaves them. */
const seedClaim = async (overrides = {}) => {
  const brandId = oid();
  const customerId = oid();

  const transaction = await Transaction.create({
    purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
    gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
    customerId,
    brandId,
    amount: PRICING.totalPayable,
    currency: "INR",
    verified: false,
    razorpayOrderId: `order_TEST${Date.now()}${Math.floor(Math.random() * 1000)}`,
    gatewayFeeBearer: GATEWAY_FEE_BEARER.PLATFORM,
  });

  const claim = await VoucherClaim.create({
    customerId,
    voucherId: oid(),
    voucherVersionId: oid(),
    versionNumber: 1,
    offerId: oid(),
    brandId,
    subBrandId: oid(),
    billAmount: PRICING.billAmount,
    offerApplied: true,
    pricing: PRICING,
    transactionId: transaction._id,
    status: VOUCHER_CLAIM_STATUS.PENDING,
    claimCode: `TD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    redemptionMode: CLAIM_REDEMPTION_MODE.AUTO,
    holdsUsageSlot: true,
    isOncePerUser: true,
    promoCode: PRICING.promoCode,
    promoDiscount: PRICING.promoDiscount,
    ...overrides,
  });

  return { transaction, claim, brandId, customerId };
};

const COLLECTIONS = [
  Transaction,
  VoucherClaim,
  VoucherClaimHistory,
  VoucherUsage,
  LedgerEntry,
  PromoCode,
  PromoCodeUsage,
  // Cleared because the unsupported-mode alert below counts rows.
  Notification,
  User,
];

/**
 * An admin to receive the alert.
 *
 * ⚠️ `notifyAdmins` fans out to one row per active admin, and with **no admin on
 * the database it writes nothing and returns quietly** — so a test that forgets
 * this seeds no rows and passes only because it found none.
 */
const seedAdmin = () =>
  User.create({
    uniqueId: `USR-ADMIN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: "test admin",
    email: `admin${Date.now()}@example.com`,
    mobile: "9700000099",
    role: ROLES.ADMIN,
    isActive: true,
  });

beforeAll(async () => {
  await connectTestDb();
  for (const model of COLLECTIONS) await model.createIndexes();
});

afterAll(async () => {
  await clearCollections(...COLLECTIONS);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(...COLLECTIONS);
});

describe("a captured payment settles the whole claim", () => {
  it("redeems, records usage, posts the ledger and completes", async () => {
    const { transaction, claim, brandId } = await seedClaim();

    const result = await settleVoucherClaimPayment({
      transaction,
      payment: capturedPayment(),
    });

    expect(result.alreadySettled).toBe(false);

    const settled = await Transaction.findById(transaction._id);
    expect(settled.verified).toBe(true);
    expect(settled.settlementStage).toBe(SETTLEMENT_STAGE.COMPLETE);

    // Phase 1: paying at the counter IS the redemption.
    const after = await VoucherClaim.findById(claim._id);
    expect(after.status).toBe(VOUCHER_CLAIM_STATUS.REDEEMED);
    expect(after.paidAt).toBeTruthy();
    expect(after.redeemedAt).toBeTruthy();

    expect(await VoucherUsage.countDocuments({ voucherClaimId: claim._id })).toBe(1);
    // COLLECTION, VENDOR_PROMO_SHARE, CONVENIENCE_FEE, PLATFORM_PROMO_COST, GATEWAY_FEE
    expect(result.ledger.posted).toBe(5);
    expect((await getVendorBalance(brandId)).balance).toBe(785);
  });

  it("writes the gateway fee from the payment, without double-counting tax", async () => {
    const { transaction } = await seedClaim();
    await settleVoucherClaimPayment({ transaction, payment: capturedPayment() });

    const settled = await Transaction.findById(transaction._id);
    // `payment.fee` is the total and already contains `payment.tax`. Adding them
    // would overstate the deduction and leave every reconciliation short.
    expect(settled.gatewayFee).toBe(17.94);
    expect(settled.tax).toBe(2.74);
    expect(settled.netReceived).toBe(760 - 17.94);

    const fee = await LedgerEntry.findOne({ entryType: LEDGER_ENTRY_TYPE.GATEWAY_FEE });
    expect(fee.amount).toBe(17.94);
  });

  it("leaves an audit row saying what happened", async () => {
    const { transaction, claim } = await seedClaim();
    await settleVoucherClaimPayment({ transaction, payment: capturedPayment() });

    const rows = await VoucherClaimHistory.find({ claimId: claim._id });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe(CLAIM_HISTORY_ACTION.PAYMENT_CAPTURED);
    expect(rows[0].toStatus).toBe(VOUCHER_CLAIM_STATUS.REDEEMED);
    expect(rows[0].snapshot.ledgerEntries).toBe(5);
  });

  it("stops at PAID when redemption is a separate step (Phase 2)", async () => {
    const { transaction, claim } = await seedClaim({
      redemptionMode: CLAIM_REDEMPTION_MODE.OUTLET_SCAN,
    });

    await settleVoucherClaimPayment({ transaction, payment: capturedPayment() });

    // The same capture, a different resting place. A behaviour switch, not a
    // migration.
    const after = await VoucherClaim.findById(claim._id);
    expect(after.status).toBe(VOUCHER_CLAIM_STATUS.PAID);
    expect(after.redeemedAt).toBeFalsy();
  });

  /**
   * ⚠️ The point of this one is that parking at `PAID` is only safe once
   * something can move a claim off it. Until the scan endpoint and the expiry
   * sweep exist, a claim that lands there has taken the customer's money and has
   * no way forward and no way out — and it does that without throwing, so
   * nothing else in the system would ever mention it.
   */
  it("raises a critical alert when the mode has no way to finish", async () => {
    await seedAdmin();
    const { transaction, claim } = await seedClaim({
      redemptionMode: CLAIM_REDEMPTION_MODE.OUTLET_SCAN,
    });

    await settleVoucherClaimPayment({ transaction, payment: capturedPayment() });

    const alert = await Notification.findOne({
      "meta.claimId": claim._id,
      severity: NOTIFICATION_SEVERITY.CRITICAL,
    });

    expect(alert).toBeTruthy();
    expect(alert.meta.redemptionMode).toBe(CLAIM_REDEMPTION_MODE.OUTLET_SCAN);
    // Says the money moved, so nobody reads it as a harmless config warning.
    expect(alert.body).toMatch(/charged/i);
  });

  it("stays quiet on the mode the build actually supports", async () => {
    await seedAdmin();
    const { transaction } = await seedClaim();

    await settleVoucherClaimPayment({ transaction, payment: capturedPayment() });

    // Without this the alert above passes for a build that shouts on every
    // single capture, which is the same as not alerting at all.
    expect(
      await Notification.countDocuments({
        severity: NOTIFICATION_SEVERITY.CRITICAL,
      }),
    ).toBe(0);
  });
});

/**
 * The enum names three modes; the code can finish one. That gap is deliberate —
 * `OUTLET_SCAN` is Phase 2 — but it is only safe while the two lists agree about
 * which mode new claims are created in.
 */
describe("the redemption mode a claim is created in is one the code can finish", () => {
  it("creates claims in a mode this build can carry to REDEEMED", () => {
    /**
     * ⚠️ If this fails, someone has pointed `DEFAULT_REDEMPTION_MODE` at a mode
     * with no redeem endpoint and no expiry sweep behind it. Every claim created
     * after that captures the customer's money and parks at `PAID` for ever.
     *
     * The fix is not to change this test. It is to ship the flow first — the
     * redeem endpoint and the sweep — and add the mode to
     * `IMPLEMENTED_REDEMPTION_MODES` in that same commit.
     */
    expect(isImplementedRedemptionMode(DEFAULT_REDEMPTION_MODE)).toBe(true);
  });

  it("does not count the Phase 2 modes as finishable yet", () => {
    expect(isImplementedRedemptionMode(CLAIM_REDEMPTION_MODE.OUTLET_SCAN)).toBe(
      false,
    );
    // `ADMIN` sits in the same boat: settle parks it at PAID too.
    expect(isImplementedRedemptionMode(CLAIM_REDEMPTION_MODE.ADMIN)).toBe(false);
  });

  it("treats an unknown value as unfinishable rather than as AUTO", () => {
    // A junk mode from a hand-edited row must not fall through to "redeem it".
    expect(isImplementedRedemptionMode(undefined)).toBe(false);
    expect(isImplementedRedemptionMode("SCAN")).toBe(false);
  });
});

describe("the browser and the webhook race on every payment", () => {
  /**
   * They fire at the same moment, always. The conditional claim on
   * `verified: false` is what makes exactly one of them do the work.
   */
  it("lets exactly one caller settle", async () => {
    const { transaction, brandId } = await seedClaim();
    const payment = capturedPayment();

    const [a, b] = await Promise.all([
      settleVoucherClaimPayment({ transaction, payment }),
      settleVoucherClaimPayment({ transaction, payment }),
    ]);

    const settledCount = [a, b].filter((r) => !r.alreadySettled).length;
    expect(settledCount).toBe(1);
    expect([a, b].filter((r) => r.alreadySettled)).toHaveLength(1);

    // And the vendor was credited once, not twice.
    expect((await getVendorBalance(brandId)).balance).toBe(785);
    expect(await VoucherUsage.countDocuments({})).toBe(1);
  });

  it("tells the loser rather than failing them", async () => {
    const { transaction } = await seedClaim();
    const payment = capturedPayment();

    await settleVoucherClaimPayment({ transaction, payment });
    const second = await settleVoucherClaimPayment({ transaction, payment });

    // A retry that finds the work done is a success, not an error.
    expect(second.alreadySettled).toBe(true);
    expect(second.transaction.verified).toBe(true);
  });
});

describe("a crash mid-settle is recoverable", () => {
  /**
   * The failure this whole design exists for.
   *
   * The conditional claim is terminal — nothing re-enters through it — and five
   * writes follow it. A process that dies in between leaves the transaction
   * `verified: true` with the work half done and **no way back in**: verify says
   * `alreadyVerified`, the webhook retry says `alreadySettled`, a replay says the
   * same. Money captured, claim still PENDING, vendor never credited.
   */
  it("resumes from a settlement abandoned after the claim", async () => {
    const { transaction, claim, brandId } = await seedClaim();

    // Simulate the crash: the claim landed, nothing after it did.
    await Transaction.updateOne(
      { _id: transaction._id },
      {
        $set: {
          verified: true,
          verifiedAt: new Date(),
          settlementStage: SETTLEMENT_STAGE.CLAIMED,
          razorpayPaymentId: "pay_CRASHED",
          gatewayFee: 17.94,
        },
      },
    );

    // Nothing downstream happened.
    expect(await VoucherUsage.countDocuments({})).toBe(0);
    expect(await LedgerEntry.countDocuments({})).toBe(0);
    expect((await VoucherClaim.findById(claim._id)).status).toBe(
      VOUCHER_CLAIM_STATUS.PENDING,
    );

    const stranded = await Transaction.findById(transaction._id);
    const result = await settleVoucherClaimPayment({
      transaction: stranded,
      payment: capturedPayment(),
      resume: true,
    });

    expect(result.alreadySettled).toBe(false);
    expect((await VoucherClaim.findById(claim._id)).status).toBe(
      VOUCHER_CLAIM_STATUS.REDEEMED,
    );
    expect(await VoucherUsage.countDocuments({})).toBe(1);
    expect((await getVendorBalance(brandId)).balance).toBe(785);
    expect((await Transaction.findById(transaction._id)).settlementStage).toBe(
      SETTLEMENT_STAGE.COMPLETE,
    );
  });

  /**
   * Resume does not need to know where it stopped.
   *
   * Every step is idempotent, so it simply runs them all again and the finished
   * ones are no-ops. That is what makes the repair path a few lines rather than
   * a state machine that has to be right about a crash it did not witness.
   */
  it("is safe to resume a settlement that already finished", async () => {
    const { transaction, brandId } = await seedClaim();
    await settleVoucherClaimPayment({ transaction, payment: capturedPayment() });

    const settled = await Transaction.findById(transaction._id);
    const again = await settleVoucherClaimPayment({
      transaction: settled,
      payment: capturedPayment(),
      resume: true,
    });

    expect(again.ledger.posted).toBe(0);
    expect(again.ledger.duplicates).toBe(5);
    expect(await VoucherUsage.countDocuments({})).toBe(1);
    // The one number that would show a double credit.
    expect((await getVendorBalance(brandId)).balance).toBe(785);
  });

  it("does not re-open a claim a human has since refunded", async () => {
    const { transaction, claim } = await seedClaim();
    await Transaction.updateOne(
      { _id: transaction._id },
      { $set: { verified: true, settlementStage: SETTLEMENT_STAGE.CLAIMED } },
    );
    // Support refunded it before the resume job got there.
    await VoucherClaim.updateOne(
      { _id: claim._id },
      { $set: { status: VOUCHER_CLAIM_STATUS.REFUNDED, holdsUsageSlot: false } },
    );

    const stranded = await Transaction.findById(transaction._id);
    await settleVoucherClaimPayment({
      transaction: stranded,
      payment: capturedPayment(),
      resume: true,
    });

    // The status update is conditional on PENDING, so the refund stands.
    expect((await VoucherClaim.findById(claim._id)).status).toBe(
      VOUCHER_CLAIM_STATUS.REFUNDED,
    );
  });
});

describe("a payment that was never captured", () => {
  it("fails the claim and releases the slot", async () => {
    const { transaction, claim } = await seedClaim();

    await expect(
      settleVoucherClaimPayment({
        transaction,
        payment: capturedPayment({
          captured: false,
          status: "failed",
          error_description: "Payment declined by the bank",
        }),
      }),
    ).rejects.toMatchObject({ statusCode: 402 });

    const after = await VoucherClaim.findById(claim._id);
    expect(after.status).toBe(VOUCHER_CLAIM_STATUS.FAILED);
    // The slot goes back so the customer can try again.
    expect(after.holdsUsageSlot).toBe(false);
    expect(await LedgerEntry.countDocuments({})).toBe(0);
  });

  it("records why", async () => {
    const { transaction, claim } = await seedClaim();
    await expect(
      settleVoucherClaimPayment({
        transaction,
        payment: capturedPayment({
          captured: false,
          status: "failed",
          error_description: "Payment declined by the bank",
        }),
      }),
    ).rejects.toMatchObject({ statusCode: 402 });

    const row = await VoucherClaimHistory.findOne({ claimId: claim._id });
    expect(row.action).toBe(CLAIM_HISTORY_ACTION.PAYMENT_FAILED);
    expect(row.reason).toBe("Payment declined by the bank");
  });
});

describe("a slot taken by someone else does not stop the money", () => {
  /**
   * The sweep-versus-late-capture case.
   *
   * `releaseStaleClaimHolds` cancels a PENDING claim and frees its slot; the
   * payment can capture afterwards, by which time another claim holds it. The
   * money is already taken, so refusing to settle would leave the customer
   * charged with nothing to show for it.
   *
   * The usage is written without the slot instead, flagged, and an admin is
   * told. A business conflict to resolve, not a technical failure to retry.
   */
  it("settles anyway and flags the conflict", async () => {
    const { transaction, claim, brandId } = await seedClaim();

    // Another claim already holds this offer's once-per-user slot.
    await VoucherUsage.create({
      voucherId: claim.voucherId,
      voucherVersionId: claim.voucherVersionId,
      versionNumber: 1,
      offerId: claim.offerId,
      customerId: claim.customerId,
      brandId,
      subBrandId: claim.subBrandId,
      voucherClaimId: oid(),
      transactionId: oid(),
      billAmount: 1000,
      paidAmount: 760,
      discountAmount: 200,
      isOncePerUser: true,
      isReversed: false,
    });

    const result = await settleVoucherClaimPayment({
      transaction,
      payment: capturedPayment(),
    });

    // The money settled. That is the point.
    expect(result.alreadySettled).toBe(false);
    expect(result.usageConflict).toBe(true);
    expect((await VoucherClaim.findById(claim._id)).status).toBe(
      VOUCHER_CLAIM_STATUS.REDEEMED,
    );
    expect((await getVendorBalance(brandId)).balance).toBe(785);

    // ...and the conflict is on the record rather than swallowed.
    const usage = await VoucherUsage.findOne({ voucherClaimId: claim._id });
    expect(usage.slotConflict).toBe(true);
    expect(usage.isOncePerUser).toBe(false);
  });
});
