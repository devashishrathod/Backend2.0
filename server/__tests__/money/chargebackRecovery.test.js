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
const Settlement = require("../../models/Settlement");
const SettlementHistory = require("../../models/SettlementHistory");
const RefundRequest = require("../../models/RefundRequest");
const LedgerEntry = require("../../models/LedgerEntry");
const Setting = require("../../models/Setting");

const {
  postChargebackLoss,
  postChargebackReversal,
} = require("../../helpers/ledger");
const { claimChargebackAdjustments } = require("../../helpers/settlements");
const { buildSettlements } = require("../../services/settlements");
const {
  LEDGER_ENTRY_TYPE,
  LEDGER_ACCOUNT,
  LEDGER_DIRECTION,
} = require("../../constants/ledger");
const { DISPUTE_STATUS } = require("../../constants/webhook");
const {
  NOTIFICATION_TYPES,
  NOTIFICATION_AUDIENCE,
} = require("../../constants/notification");
const { SETTLEMENT_STATUS } = require("../../constants/settlement");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");
const { PAYMENT_STATUS } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

let BRAND;
let seq = 0;

/**
 * A chargeback the bank ruled against us.
 *
 * ### Why this file exists
 *
 * `vendor_settlement_plan.md` §7.5 chose the strategy — *"4. Agle settlement se
 * recovery — payout ke baad wala default"* — and none of it was built.
 * `chargebackAdjustment` sat hardcoded at `0`, and `CHARGEBACK` /
 * `CHARGEBACK_REVERSAL` were in the ledger's rules table with **no code writing
 * either**. `LedgerEntry.disputeId` was even declared as an `ObjectId`, which
 * Razorpay's `disp_…` can never be — so the first real entry would have died on
 * a cast error nobody had ever hit.
 *
 * So a payment could be settled, paid out, and then pulled back by the
 * customer's bank, and the platform absorbed the entire loss silently while the
 * books still showed a healthy sale.
 */

const VENDOR_SHARE = 785; // netBill 800 − vendorPromoCost 15

/**
 * A captured payment, and — when the overrides describe one — the dispute
 * against it.
 *
 * ⚠️ The dispute is its **own row** now. It was ten fields on the payment, which
 * holds exactly one; Razorpay does not promise one, and the second silently
 * replaced the first. `disputeStatus` / `disputeId` are still accepted here so
 * every test below reads as it did, and they now build a `Dispute` as well.
 */
const payment = async (overrides = {}) => {
  const { disputeStatus, disputeId, ...fields } = overrides;

  const transaction = await Transaction.create({
    purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
    gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
    customerId: oid(),
    brandId: BRAND,
    amount: 811.8,
    paidAmount: 811.8,
    status: PAYMENT_STATUS.CAPTURED,
    verified: true,
    verifiedAt: ago(5 * DAY),
    fundsReceivedAt: ago(4 * DAY),
    settlementHold: false,
    amountRefunded: 0,
    invoiceId: `TD/VCH/26-27/${Math.floor(Math.random() * 1e6)}`,
    voucher: {
      claimId: oid(),
      netBill: 800,
      vendorPayable: 800,
      vendorPromoCost: 15,
      commissionAmount: 0,
    },
    // Kept on the payment as the denormalised summary a worklist filters on.
    ...(disputeStatus ? { disputeStatus, disputeId, isDisputed: false } : {}),
    ...fields,
  });

  if (disputeStatus) {
    const id = disputeId || `disp_${Math.random().toString(36).slice(2, 12)}`;

    await Dispute.create({
      disputeId: id,
      transactionId: transaction._id,
      brandId: transaction.brandId,
      status: disputeStatus,
      amount: 811.8,
      lastEventAt: new Date(),
    });

    /**
     * ⚠️ And the ledger row, because a `LOST` dispute never exists without one —
     * the webhook writes both in the same breath.
     *
     * `claimChargebackAdjustments` recovers exactly what the ledger booked, and
     * deliberately refuses to claim a loss the books do not carry: claiming it
     * would stamp the recovery lock for a recovery of zero and mark it settled
     * for ever, having taken nothing. A fixture without this row is testing a
     * state production cannot reach.
     */
    if (disputeStatus === DISPUTE_STATUS.LOST) {
      await postChargebackLoss({ transaction, disputeId: id });
    }
  }

  return transaction;
};

const settlement = (overrides = {}) => {
  seq += 1;
  return Settlement.create({
    brandId: BRAND,
    periodStart: ago(6 * DAY),
    periodEnd: ago(4 * DAY),
    idempotencyKey: `STL:${BRAND}:${seq}:${Math.random()}`,
    status: SETTLEMENT_STATUS.PAID,
    netPayable: VENDOR_SHARE,
    ...overrides,
  });
};

const vendorPayable = async () => {
  const rows = await LedgerEntry.find({
    account: LEDGER_ACCOUNT.VENDOR_PAYABLE,
    isDeleted: false,
  }).lean();
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
  Settlement,
  SettlementHistory,
  RefundRequest,
  LedgerEntry,
  Setting,
];

beforeAll(async () => {
  await connectTestDb();
  for (const m of [Transaction, Dispute, Settlement, LedgerEntry]) await m.createIndexes();
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

describe("booking the loss", () => {
  it("debits the vendor's payable when we lose", async () => {
    const txn = await payment();

    const result = await postChargebackLoss({
      transaction: txn,
      disputeId: "disp_A1",
    });

    expect(result.posted).toBe(1);
    expect(await vendorPayable()).toBe(-VENDOR_SHARE);
  });

  /**
   * ⚠️ The dispute amount is what the **customer** paid — it includes our
   * convenience fee and our half of the promo. Charging that whole figure to the
   * vendor bills them for our side of the sale.
   */
  it("never takes more than the vendor's own share", async () => {
    const txn = await payment();

    const result = await postChargebackLoss({
      transaction: txn,
      disputeId: "disp_A1",
      // The full amount the customer paid, fee and all.
      amount: 811.8,
    });

    expect(result.amount).toBe(VENDOR_SHARE);
    expect(await vendorPayable()).toBe(-VENDOR_SHARE);
  });

  /**
   * ⚠️ Razorpay redelivers dispute webhooks **and** sends them out of order.
   * Without `ledger_type_dispute_unique` one chargeback claws the vendor back
   * once per delivery.
   */
  it("books one row however many times the webhook fires", async () => {
    const txn = await payment();

    await postChargebackLoss({ transaction: txn, disputeId: "disp_A1" });
    const second = await postChargebackLoss({
      transaction: txn,
      disputeId: "disp_A1",
    });

    expect(second.duplicate).toBe(true);
    expect(await vendorPayable()).toBe(-VENDOR_SHARE);
    expect(
      await LedgerEntry.countDocuments({
        entryType: LEDGER_ENTRY_TYPE.CHARGEBACK,
      }),
    ).toBe(1);
  });

  /**
   * The dispute is the key, not the transaction — a payment can be disputed
   * after it was already refunded, and those rows share a `transactionId`.
   */
  it("keeps two disputes on one payment apart", async () => {
    const txn = await payment();

    await postChargebackLoss({ transaction: txn, disputeId: "disp_A1", amount: 100 });
    await postChargebackLoss({ transaction: txn, disputeId: "disp_A2", amount: 200 });

    expect(
      await LedgerEntry.countDocuments({
        entryType: LEDGER_ENTRY_TYPE.CHARGEBACK,
      }),
    ).toBe(2);
    expect(await vendorPayable()).toBe(-300);
  });

  it("gives it back when the dispute is won on appeal", async () => {
    const txn = await payment();
    const lost = await postChargebackLoss({
      transaction: txn,
      disputeId: "disp_A1",
    });

    await postChargebackReversal({
      transaction: txn,
      disputeId: "disp_A1",
      amount: lost.amount,
    });

    expect(await vendorPayable()).toBe(0);
  });

  /**
   * A `won` with no prior `lost` must credit nobody — otherwise a dispute that
   * was never charged back hands the vendor money out of thin air.
   */
  it("credits nothing when no loss was ever booked", async () => {
    const txn = await payment();

    const result = await postChargebackReversal({
      transaction: txn,
      disputeId: "disp_A1",
      amount: 0,
    });

    expect(result.posted).toBe(0);
    expect(await vendorPayable()).toBe(0);
  });
});

describe("recovering it from the next cycle", () => {
  it("claims a lost dispute on a payment that was paid out", async () => {
    const s = await settlement();
    await payment({
      settlementId: s._id,
      disputeStatus: DISPUTE_STATUS.LOST,
      disputeId: "disp_A1",
      settlementHold: true,
    });

    const next = await settlement();
    const claimed = await claimChargebackAdjustments({
      settlementId: next._id,
      brandId: BRAND,
    });

    expect(claimed).toHaveLength(1);
  });

  /**
   * ⚠️ The trap the refund side documents, and the reason this is locked: a
   * figure computed live from "this brand's lost disputes" deducts the same one
   * every cycle, for ever, while each month's arithmetic looks self-consistent.
   */
  it("recovers it exactly once, never in a later cycle too", async () => {
    const s = await settlement();
    await payment({
      settlementId: s._id,
      disputeStatus: DISPUTE_STATUS.LOST,
      disputeId: "disp_A1",
      settlementHold: true,
    });

    const first = await settlement();
    expect(
      await claimChargebackAdjustments({ settlementId: first._id, brandId: BRAND }),
    ).toHaveLength(1);

    const second = await settlement();
    expect(
      await claimChargebackAdjustments({ settlementId: second._id, brandId: BRAND }),
    ).toHaveLength(0);
  });

  /**
   * ⚠️ If the dispute landed before payout, `settlementHold` already kept the
   * payment out of every cycle — the vendor never got it, so there is nothing to
   * claw. Deducting anyway takes it from sales they *were* paid for.
   */
  it("does not recover a dispute on a payment nobody was paid for", async () => {
    await payment({
      settlementId: null,
      disputeStatus: DISPUTE_STATUS.LOST,
      disputeId: "disp_A1",
      settlementHold: true,
    });

    const next = await settlement();
    expect(
      await claimChargebackAdjustments({ settlementId: next._id, brandId: BRAND }),
    ).toHaveLength(0);
  });

  it("leaves a dispute we won alone", async () => {
    const s = await settlement();
    await payment({
      settlementId: s._id,
      disputeStatus: DISPUTE_STATUS.WON,
      disputeId: "disp_A1",
    });

    const next = await settlement();
    expect(
      await claimChargebackAdjustments({ settlementId: next._id, brandId: BRAND }),
    ).toHaveLength(0);
  });

  /** The whole point: it comes out of the next payout's figure. */
  it("deducts it from the next cycle's netPayable", async () => {
    const old = await settlement();
    await payment({
      settlementId: old._id,
      disputeStatus: DISPUTE_STATUS.LOST,
      disputeId: "disp_A1",
      settlementHold: true,
    });

    /**
     * **Two** fresh sales, so the cycle still has something to pay after the
     * recovery. With one, the arithmetic nets to exactly zero and the settlement
     * correctly goes `CARRIED_FORWARD` instead — which is the next test.
     */
    await payment();
    await payment();

    const built = await buildSettlements();
    expect(built.built).toBe(1);

    const next = await Settlement.findOne({
      brandId: BRAND,
      status: SETTLEMENT_STATUS.PENDING_APPROVAL,
    }).lean();

    expect(next.chargebackAdjustment).toBe(VENDOR_SHARE);
    // Two clean sales less one recovered chargeback.
    expect(next.netPayable).toBe(r2(2 * VENDOR_SHARE - VENDOR_SHARE));
  });

  /**
   * ⚠️ When the recovery swallows the whole cycle, the settlement carries
   * forward — and carrying forward **releases** its claims, including the
   * chargeback's. That is correct and load-bearing: nothing was deducted, so the
   * chargeback must stay recoverable rather than being silently forgiven.
   */
  it("stays recoverable when the cycle it lands in pays nothing", async () => {
    const old = await settlement();
    const disputed = await payment({
      settlementId: old._id,
      disputeStatus: DISPUTE_STATUS.LOST,
      disputeId: "disp_A1",
      settlementHold: true,
    });

    // One sale, exactly cancelled by the recovery.
    await payment();

    await buildSettlements();

    const cycle = await Settlement.findOne({
      brandId: BRAND,
      status: SETTLEMENT_STATUS.CARRIED_FORWARD,
    }).lean();
    expect(cycle).toBeTruthy();
    expect(cycle.netPayable).toBe(0);

    /**
     * Released, so the next cycle can recover it for real.
     *
     * ⚠️ Checked on `Dispute`, not on the payment. The recovery lock moved there
     * when one payment turned out to be able to carry several disputes, and a
     * test still asserting on `Transaction.chargebackSettlementId` would pass
     * for ever by reading a field nothing writes.
     */
    const stillClaimed = await Dispute.countDocuments({
      transactionId: disputed._id,
      recoverySettlementId: { $ne: null },
    });
    expect(stillClaimed).toBe(0);
  });

  /**
   * ⚠️ And the vendor is **told**.
   *
   * `CARRIED_FORWARD` is deliberately silent — for the routine case, a cycle
   * below the minimum payout that rolls into the next one. This is not that. The
   * outlet traded, expected a payout, and got nothing because a chargeback ate
   * it, and until this notice existed nothing anywhere said so. From their side
   * that is indistinguishable from a payout that quietly failed: the first
   * anybody heard was a support call, usually weeks later, usually about a
   * dispute whose deadline had already gone.
   */
  it("tells the vendor why the cycle paid them nothing", async () => {
    const old = await settlement();
    await payment({
      settlementId: old._id,
      disputeStatus: DISPUTE_STATUS.LOST,
      disputeId: "disp_A1",
      settlementHold: true,
    });
    await payment();

    await buildSettlements();

    const notice = mockNotify.mock.calls.find(
      ([a]) => a.type === NOTIFICATION_TYPES.SETTLEMENT_CARRIED_FORWARD,
    );

    expect(notice).toBeDefined();
    expect(notice[0].audience).toBe(NOTIFICATION_AUDIENCE.VENDOR);
    // The cause, in their words — not "carried forward", which is ours.
    expect(notice[0].body).toContain("chargeback");
    expect(notice[0].meta.chargebackAdjustment).toBe(VENDOR_SHARE);
    // ⚠️ Never an invoice. There is nothing for them to pay us.
    expect(notice[0].body).toMatch(/nothing you need to do/i);
  });

  /**
   * The routine `CARRIED_FORWARD` stays silent. A cycle below the minimum payout
   * is not news, and sending one anyway trains people to ignore the message that
   * says their money is not coming.
   */
  it("says nothing when the cycle merely fell below the minimum", async () => {
    // ⚠️ `customer.settlement.…` — the config is namespaced by audience.
    await Setting.findOneAndUpdate(
      {},
      { $set: { "customer.settlement.minPayoutAmount": 100000 } },
      { upsert: true },
    );
    await payment();

    await buildSettlements();

    const cycle = await Settlement.findOne({
      brandId: BRAND,
      status: SETTLEMENT_STATUS.CARRIED_FORWARD,
    }).lean();
    expect(cycle).toBeTruthy();

    expect(
      mockNotify.mock.calls.some(
        ([a]) => a.type === NOTIFICATION_TYPES.SETTLEMENT_CARRIED_FORWARD,
      ),
    ).toBe(false);
  });
});
