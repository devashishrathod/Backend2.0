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
const Settlement = require("../../models/Settlement");
const SettlementHistory = require("../../models/SettlementHistory");
const VoucherClaimHistory = require("../../models/VoucherClaimHistory");
const { releaseTransactionHold } = require("../../services/transactions");
const { abandonSettlement } = require("../../services/settlements");
const { SETTLEMENT_STATUS } = require("../../constants/settlement");
const { DISPUTE_STATUS } = require("../../constants/webhook");
const {
  REFUND_REQUEST_STATUS,
  REFUND_REASON,
} = require("../../constants/refund");
const { CLAIM_HISTORY_ACTION } = require("../../constants/voucherClaim");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");
const { PAYMENT_STATUS, ROLES } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms);

let BRAND;
let seq = 0;

const admin = () => ({ role: ROLES.ADMIN, userId: oid() });
const vendor = () => ({ role: ROLES.VENDOR, brandId: BRAND, userId: oid() });

/**
 * The two escape hatches this system was designed around and never grew.
 *
 * Both are the same shape of defect: a comment in the code promises an operator
 * action, the state machine has a place for it, and no caller exists. The money
 * sits in a state nothing can move it out of, with no error and no log — which
 * is the failure mode `settlementClaims.js` calls out as the worst one here.
 */

const held = (overrides = {}) =>
  Transaction.create({
    purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
    gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
    customerId: oid(),
    brandId: BRAND,
    amount: 810,
    paidAmount: 810,
    status: PAYMENT_STATUS.CAPTURED,
    verified: true,
    verifiedAt: ago(3 * DAY),
    fundsReceivedAt: ago(2 * DAY),
    settlementHold: true,
    settlementHoldReason: "Chargeback WON (disp_1)",
    amountRefunded: 0,
    invoiceId: `TD/VCH/26-27/${Math.floor(Math.random() * 1e6)}`,
    voucher: { claimId: oid(), netBill: 800, vendorPayable: 800 },
    ...overrides,
  });

const settlement = (overrides = {}) => {
  seq += 1;
  return Settlement.create({
    brandId: BRAND,
    periodStart: ago(3 * DAY),
    periodEnd: ago(DAY),
    idempotencyKey: `STL:${BRAND}:${seq}:${Math.random()}`,
    settlementNumber: `STL-2026-${String(seq).padStart(5, "0")}`,
    status: SETTLEMENT_STATUS.FAILED,
    netPayable: 800,
    grossCollected: 800,
    transactionCount: 1,
    ...overrides,
  });
};

const holdOn = async (id) =>
  (await Transaction.findById(id).lean()).settlementHold;

beforeAll(async () => {
  await connectTestDb();
  for (const m of [Transaction, RefundRequest, Settlement]) {
    await m.createIndexes();
  }
});

afterAll(async () => {
  await clearCollections(
    Transaction,
    RefundRequest,
    Settlement,
    SettlementHistory,
    VoucherClaimHistory,
  );
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(
    Transaction,
    RefundRequest,
    Settlement,
    SettlementHistory,
    VoucherClaimHistory,
  );
  BRAND = oid();
  mockNotify.mockClear();
});

describe("releasing a hold nothing else can release", () => {
  /**
   * ⚠️ The case that had no exit at all. The dispute webhook puts the hold on
   * for **every** dispute event including `won`, deliberately, and says a person
   * will take it off — but no endpoint, script or job called the releaser.
   */
  it("releases a hold left by a chargeback we won", async () => {
    const txn = await held({
      disputeStatus: DISPUTE_STATUS.WON,
      disputeResolvedAt: new Date(),
    });

    const result = await releaseTransactionHold(admin(), txn._id, {
      reason: "chargeback won, vendor bears no loss",
    });

    expect(result.released).toBe(true);
    expect(await holdOn(txn._id)).toBe(false);
  });

  /** A chargeback we lost is the whole reason `allowDisputed` is a parameter. */
  it("releases a hold left by a chargeback we lost, when a person decides so", async () => {
    const txn = await held({
      disputeStatus: DISPUTE_STATUS.LOST,
      disputeResolvedAt: new Date(),
      settlementHoldReason: "Chargeback LOST (disp_2)",
    });

    const result = await releaseTransactionHold(admin(), txn._id, {
      reason: "goodwill: platform absorbs this one",
    });

    expect(result.released).toBe(true);
  });

  /**
   * ⚠️ A `FAILED` refund is an **open** refund — `REFUND_OPEN_STATUSES` says so,
   * and the model's pre-save hook derives `isOpen` from it, so this cannot be
   * faked with `isOpen: false`.
   *
   * That is deliberate and it is right: a refund that failed is one the customer
   * has been *promised* and has not received. Releasing the vendor's money there
   * would settle a sale the customer is still owed a refund on — this endpoint
   * must not be the way around that. The exit is to settle the refund, which
   * today means the `MANUAL_BANK` fallback (S1.5).
   *
   * Written this way round on purpose: an earlier draft of this suite asserted
   * the release *succeeded*, which would have made the endpoint a hole in the
   * one guarantee the hold exists to give.
   */
  it("refuses when a refund failed and the customer is still owed", async () => {
    const txn = await held({ settlementHoldReason: "Refunded (abc)" });
    await RefundRequest.create({
      claimId: txn.voucher.claimId,
      transactionId: txn._id,
      customerId: txn.customerId,
      brandId: BRAND,
      claimCode: "TD-AAA111",
      requestedAmount: 100,
      reason: REFUND_REASON.OTHER,
      status: REFUND_REQUEST_STATUS.FAILED,
    });

    await expect(
      releaseTransactionHold(admin(), txn._id, {
        reason: "paid the customer by NEFT outside the platform",
      }),
    ).rejects.toThrow(/customer is owed a refund on|still not been\s+paid back/i);

    expect(await holdOn(txn._id)).toBe(true);
  });

  /** A refund made in the Razorpay dashboard leaves a hold and no request. */
  it("releases a hold left by a refund made outside Trydood", async () => {
    const txn = await held({
      settlementHoldReason: "Refunded outside Trydood",
      amountRefunded: 810,
    });

    const result = await releaseTransactionHold(admin(), txn._id, {
      reason: "refunded in the dashboard; reconciled by hand",
    });

    expect(result.released).toBe(true);
  });

  /**
   * ⚠️ Not an admin's to override. The customer is still owed a decision, and
   * until they get one the money is not the vendor's — deciding the refund
   * releases the hold by itself.
   */
  it("refuses while a refund is still open, and says so", async () => {
    const txn = await held();
    await RefundRequest.create({
      claimId: txn.voucher.claimId,
      transactionId: txn._id,
      customerId: txn.customerId,
      brandId: BRAND,
      claimCode: "TD-BBB222",
      requestedAmount: 100,
      reason: REFUND_REASON.OTHER,
      status: REFUND_REQUEST_STATUS.REQUESTED,
      isOpen: true,
    });

    await expect(
      releaseTransactionHold(admin(), txn._id, { reason: "let it through" }),
    ).rejects.toThrow(/still open/i);

    expect(await holdOn(txn._id)).toBe(true);
  });

  /**
   * The bank has not decided yet. Releasing now could pay out money that is
   * about to be pulled back — so the message tells them to wait, not to retry.
   */
  it("refuses while a chargeback is unresolved, and says to wait", async () => {
    const txn = await held({ isDisputed: true, disputeResolvedAt: null });

    await expect(
      releaseTransactionHold(admin(), txn._id, { reason: "pay the vendor" }),
    ).rejects.toThrow(/has not resolved yet|about to be taken back/i);
  });

  it("requires a written reason", async () => {
    const txn = await held();

    await expect(
      releaseTransactionHold(admin(), txn._id, {}),
    ).rejects.toThrow(/why this hold is being released/i);
  });

  it("refuses anyone who is not an admin", async () => {
    const txn = await held();

    await expect(
      releaseTransactionHold(vendor(), txn._id, { reason: "mine please" }),
    ).rejects.toThrow(/only an admin/i);
  });

  /** An admin re-clicking a button that already worked is not an error. */
  it("says plainly when nothing was held", async () => {
    const txn = await held({ settlementHold: false });

    const result = await releaseTransactionHold(admin(), txn._id, {
      reason: "again",
    });

    expect(result.released).toBe(false);
    expect(result.alreadyReleasable).toBe(true);
  });

  it("404s on a payment that is not there", async () => {
    await expect(
      releaseTransactionHold(admin(), oid(), { reason: "x" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  /**
   * A money decision a person made, recorded where the rest of that claim's
   * story is — and admin-only, because it names a dispute outcome the customer
   * may still believe went their way.
   */
  it("writes an audit row naming who decided and why", async () => {
    const txn = await held({
      disputeStatus: DISPUTE_STATUS.WON,
      disputeResolvedAt: new Date(),
    });
    const who = admin();

    await releaseTransactionHold(who, txn._id, {
      reason: "chargeback won on 2 Sep",
    });

    const row = await VoucherClaimHistory.findOne({
      transactionId: txn._id,
      action: CLAIM_HISTORY_ACTION.SETTLEMENT_HOLD_RELEASED,
    }).lean();

    expect(row).toBeTruthy();
    expect(String(row.performedBy)).toBe(String(who.userId));
    expect(row.reason).toMatch(/chargeback won/i);
  });

  /** The point of the whole thing: the money can now actually be settled. */
  it("makes the payment eligible for the next settlement run", async () => {
    const { buildEligibilityFilter } = require("../../helpers/settlements");
    const txn = await held({
      disputeStatus: DISPUTE_STATUS.WON,
      disputeResolvedAt: new Date(),
    });

    const eligible = () =>
      Transaction.countDocuments(
        buildEligibilityFilter({
          brandId: BRAND,
          eligibleBefore: new Date(),
          fundsReceivedBefore: new Date(),
        }),
      );

    expect(await eligible()).toBe(0);

    await releaseTransactionHold(admin(), txn._id, { reason: "won" });

    expect(await eligible()).toBe(1);
  });
});

describe("abandoning a payout that will never work", () => {
  /**
   * ⚠️ `FAILED → ABANDONED` was in the state machine from the start and nothing
   * called it. `ABANDONED` is the only way a FAILED settlement releases its
   * rows, so a brand that closed left its takings claimed for ever.
   */
  it("releases the rows a failed settlement was holding", async () => {
    const s = await settlement();
    const txn = await held({ settlementHold: false, settlementId: s._id });

    const result = await abandonSettlement(admin(), s._id, {
      reason: "brand closed; account cannot be corrected",
    });

    expect(result.status).toBe(SETTLEMENT_STATUS.ABANDONED);
    expect(
      (await Transaction.findById(txn._id).lean()).settlementId,
    ).toBeNull();
  });

  it("only from FAILED — a cancel is the answer anywhere else", async () => {
    const s = await settlement({ status: SETTLEMENT_STATUS.APPROVED });

    await expect(
      abandonSettlement(admin(), s._id, { reason: "give up" }),
    ).rejects.toThrow(/only a failed settlement can be abandoned/i);
  });

  it("requires a written reason", async () => {
    const s = await settlement();

    await expect(abandonSettlement(admin(), s._id, {})).rejects.toThrow(
      /why this payout is being abandoned/i,
    );
  });

  it("refuses anyone who is not an admin", async () => {
    const s = await settlement();

    await expect(
      abandonSettlement(vendor(), s._id, { reason: "mine" }),
    ).rejects.toThrow(/only an admin/i);
  });

  it("leaves a history row with the reason", async () => {
    const s = await settlement();

    await abandonSettlement(admin(), s._id, { reason: "vendor has left" });

    const row = await SettlementHistory.findOne({
      settlementId: s._id,
      toStatus: SETTLEMENT_STATUS.ABANDONED,
    }).lean();

    expect(row.reason).toMatch(/vendor has left/i);
  });

  /**
   * The released rows have to be genuinely re-settleable, not merely detached —
   * otherwise this swaps one silent trap for another.
   */
  it("puts the money back in reach of the next cycle", async () => {
    const { buildEligibilityFilter } = require("../../helpers/settlements");
    const s = await settlement();
    await held({ settlementHold: false, settlementId: s._id });

    const eligible = () =>
      Transaction.countDocuments(
        buildEligibilityFilter({
          brandId: BRAND,
          eligibleBefore: new Date(),
          fundsReceivedBefore: new Date(),
        }),
      );

    expect(await eligible()).toBe(0);

    await abandonSettlement(admin(), s._id, { reason: "written off" });

    expect(await eligible()).toBe(1);
  });
});
