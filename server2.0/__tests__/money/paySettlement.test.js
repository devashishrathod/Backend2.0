const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Settlement = require("../../models/Settlement");
const SettlementHistory = require("../../models/SettlementHistory");
const PayoutLeg = require("../../models/PayoutLeg");
const Transaction = require("../../models/Transaction");
const Brand = require("../../models/Brand");
const Bank = require("../../models/Bank");
const {
  startPayout,
  confirmPayout,
  failPayout,
  retryPayout,
} = require("../../services/settlements");
const { generateBrandMerchantId } = require("../../helpers/brands");
const { SETTLEMENT_STATUS } = require("../../constants/settlement");
const { PAYOUT_TYPE, PAYOUT_LEG_STATUS } = require("../../constants/payout");
const { ROLES } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms);

let BRAND;
let BANK_ID;

const admin = () => ({ role: ROLES.ADMIN, userId: oid() });
const vendor = () => ({ role: ROLES.VENDOR, brandId: BRAND, userId: oid() });

/**
 * ⚠️ `models/Bank.js` is a **CGPEY penny-drop verification record**, not a
 * bank-account model — fourteen required fields, all filled only by a paid
 * verification call.
 */
const seedBank = async (overrides = {}) => {
  const bank = await Bank.create({
    brandId: BRAND,
    accountHolderName: "Cafe Mocha",
    // Padded to keep this at 10 digits. Unpadded it produced an 8-digit
    // number one run in ten, which `isValidAccountNumber` (9-18) rejects.
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

const snapshotOf = (bank) => ({
  accountHolderName: bank.accountHolderName,
  maskedAccountNumber: bank.maskedAccountNumber,
  accountLast4Digits: bank.accountLast4Digits,
  ifscCode: bank.ifscCode,
  bankName: bank.bankName,
  bankId: bank._id,
  verifiedAt: bank.verifiedAt,
});

const settlement = async (overrides = {}) => {
  const bank = await Bank.findById(BANK_ID).lean();
  return Settlement.create({
    brandId: BRAND,
    periodStart: ago(6 * DAY),
    periodEnd: ago(3 * DAY),
    idempotencyKey: `STL:${BRAND}:${Date.now()}:${Math.random()}`,
    status: SETTLEMENT_STATUS.APPROVED,
    bankSnapshot: bank ? snapshotOf(bank) : undefined,
    grossCollected: 1600,
    netPayable: 1600,
    transactionCount: 2,
    ...overrides,
  });
};

beforeAll(async () => {
  await connectTestDb();
  for (const m of [Settlement, SettlementHistory, PayoutLeg, Transaction, Brand, Bank]) {
    await m.createIndexes();
  }
});

afterAll(async () => {
  await clearCollections(
    Settlement,
    SettlementHistory,
    PayoutLeg,
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
    Transaction,
    Brand,
    Bank,
  );
  BRAND = oid();
  BANK_ID = null;
  await seedBank();
});

describe("starting a payout", () => {
  it("opens a leg and moves the settlement to processing", async () => {
    const s = await settlement();

    const result = await startPayout(admin(), s._id);

    expect(result.status).toBe(SETTLEMENT_STATUS.PROCESSING);
    expect(result.leg.legNumber).toBe(1);
    expect(result.leg.amount).toBe(1600);
    expect(result.leg.status).toBe(PAYOUT_LEG_STATUS.INITIATED);
  });

  /**
   * The leg records where **this attempt** sent the money. A retry after a bank
   * change must not leave a UTR pointing at an account nobody paid.
   */
  it("copies the payee onto the leg itself", async () => {
    const s = await settlement();
    const result = await startPayout(admin(), s._id);

    expect(result.leg.bankLast4).toBe("7890");
  });

  it("refuses anyone who is not an admin", async () => {
    const s = await settlement();
    await expect(startPayout(vendor(), s._id)).rejects.toThrow(/only an admin/i);
  });

  it("refuses a settlement that is not approved", async () => {
    const s = await settlement({ status: SETTLEMENT_STATUS.PENDING_APPROVAL });
    await expect(startPayout(admin(), s._id)).rejects.toThrow(
      /pending approval and is not ready to pay/i,
    );
  });

  /**
   * `CARRIED_FORWARD` is where a non-positive payable belongs. A `PAID`
   * settlement writes a `PAYOUT` ledger entry, and booking a payout for money no
   * bank transfer carried makes `reconcileLedger` shout about drift.
   */
  it("refuses to pay nothing", async () => {
    const s = await settlement({ netPayable: 0 });
    await expect(startPayout(admin(), s._id)).rejects.toThrow(/nothing to pay/i);
  });

  /**
   * ⚠️ `(payoutType, settlementId, legNumber)` is unique, so a double-click
   * produces one leg and one 409 rather than two NEFTs for the same money.
   */
  it("lets only one of two concurrent starts through", async () => {
    const s = await settlement();

    const results = await Promise.allSettled([
      startPayout(admin(), s._id),
      startPayout(admin(), s._id),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await PayoutLeg.countDocuments({ settlementId: s._id }),
    ).toBe(1);
  });
});

/**
 * ⚠️ The taint has to be re-checked **here**, not only at approval.
 *
 * `taintSettlement` acts on `SETTLEMENT_PRE_PAYOUT_STATUSES`, and `APPROVED` is
 * one of them — so a `dispute.created` or a refund landing between the approval
 * and the payout flags a settlement that has already been signed off. Approval
 * checking the flag is not enough: the entire point of that window is that hours
 * pass inside it. `startPayout` used to check only status, netPayable and the
 * bank, so a payment we were about to lose to a chargeback was paid out anyway —
 * by MANUAL_BANK NEFT, which has no recall.
 */
describe("a taint that lands after approval", () => {
  it("stops the payout", async () => {
    const s = await settlement({ needsRevalidation: true });

    await expect(startPayout(admin(), s._id)).rejects.toThrow(
      /stopped being eligible after it was approved/i,
    );
  });

  it("opens no payout leg at all", async () => {
    const s = await settlement({ needsRevalidation: true });

    await expect(startPayout(admin(), s._id)).rejects.toThrow();

    expect(await PayoutLeg.countDocuments({ settlementId: s._id })).toBe(0);
  });

  /**
   * `ON_HOLD` rather than a bare refusal, so it lands on the worklist that
   * already exists for it — otherwise the admin's next click refuses again with
   * nothing to act on.
   */
  it("parks it on hold so somebody can act on it", async () => {
    const s = await settlement({ needsRevalidation: true });

    await expect(startPayout(admin(), s._id)).rejects.toThrow();

    const after = await Settlement.findById(s._id).lean();
    expect(after.status).toBe(SETTLEMENT_STATUS.ON_HOLD);
  });

  it("says how many payments went bad", async () => {
    const s = await settlement({
      needsRevalidation: true,
      taintedTransactionIds: [oid(), oid()],
    });

    await expect(startPayout(admin(), s._id)).rejects.toThrow();

    const history = await SettlementHistory.findOne({
      settlementId: s._id,
      toStatus: SETTLEMENT_STATUS.ON_HOLD,
    }).lean();
    expect(history.reason).toMatch(/2 claimed payment/i);
  });

  it("still pays a settlement that was never tainted", async () => {
    const s = await settlement();

    const result = await startPayout(admin(), s._id);

    expect(result.status).toBe(SETTLEMENT_STATUS.PROCESSING);
  });
});

describe("the bank account is checked again before the money leaves", () => {
  /**
   * ⚠️ A vendor changing their account mid-cycle is usually a **closed**
   * account, and paying into it is worse than not paying: the NEFT bounces days
   * later, or lands somewhere they no longer control. NEFT has no recall.
   */
  it("refuses when the account changed after approval", async () => {
    const s = await settlement();

    // The vendor updates their bank details — `createBank.js` soft-deletes the
    // old record and repoints `brand.BankId`.
    await Bank.updateOne({ _id: BANK_ID }, { $set: { isDeleted: true } });
    await seedBank({ accountLast4Digits: "4321", maskedAccountNumber: "XXXXXX4321" });

    await expect(startPayout(admin(), s._id)).rejects.toThrow(
      /bank account changed after the settlement was approved/i,
    );
  });

  it("names both accounts so an admin can tell what happened", async () => {
    const s = await settlement();
    await Bank.updateOne({ _id: BANK_ID }, { $set: { isDeleted: true } });
    await seedBank({ accountLast4Digits: "4321", maskedAccountNumber: "XXXXXX4321" });

    await expect(startPayout(admin(), s._id)).rejects.toThrow(/…7890 → …4321/);
  });

  it("parks it on hold rather than leaving it approved", async () => {
    const s = await settlement();
    await Bank.updateOne({ _id: BANK_ID }, { $set: { isDeleted: true } });
    await seedBank({ accountLast4Digits: "4321", maskedAccountNumber: "XXXXXX4321" });

    await expect(startPayout(admin(), s._id)).rejects.toThrow();

    const after = await Settlement.findById(s._id).lean();
    expect(after.status).toBe(SETTLEMENT_STATUS.ON_HOLD);
    // And no money left.
    expect(await PayoutLeg.countDocuments({ settlementId: s._id })).toBe(0);
  });

  /**
   * `isVerified`, not just "a record exists" — a CGPEY row can exist for an
   * account the penny drop failed on.
   */
  it("refuses when the account is no longer verified", async () => {
    const s = await settlement();
    await Bank.updateOne({ _id: BANK_ID }, { $set: { isVerified: false } });

    await expect(startPayout(admin(), s._id)).rejects.toThrow(
      /no longer verified/i,
    );
  });
});

describe("confirming the money landed", () => {
  const started = async (overrides = {}) => {
    const s = await settlement(overrides);
    await startPayout(admin(), s._id);
    return Settlement.findById(s._id).lean();
  };

  it("records the UTR and marks the settlement paid", async () => {
    const s = await started();

    const result = await confirmPayout(admin(), s._id, {
      utr: "N123456789012345",
      mode: "NEFT",
    });

    expect(result.settled).toBe(true);
    expect(result.status).toBe(SETTLEMENT_STATUS.PAID);
    expect(result.leg.utr).toBe("N123456789012345");
  });

  /**
   * `MANUAL_BANK` has no callback — a person is the confirmation, and the UTR is
   * the one field a vendor quotes back when money has not landed.
   */
  it("insists on a bank reference", async () => {
    const s = await started();

    await expect(confirmPayout(admin(), s._id, {})).rejects.toThrow(
      /bank reference \(UTR\) is required/i,
    );
  });

  /**
   * ⚠️ Marking the settlement paid on the first leg would release it from every
   * worklist while half the money is still owed — and the vendor would have no
   * way to say so except by counting their own bank statement.
   */
  it("stays in processing until the legs add up", async () => {
    const s = await started();

    // Only part of it went out — the admin split it across two NEFTs.
    await PayoutLeg.updateOne(
      { settlementId: s._id, legNumber: 1 },
      { $set: { amount: 1000 } },
    );

    const first = await confirmPayout(admin(), s._id, { utr: "N1" });

    expect(first.settled).toBe(false);
    expect(first.paidSoFar).toBe(1000);
    expect(first.remaining).toBe(600);
    expect(
      (await Settlement.findById(s._id).lean()).status,
    ).toBe(SETTLEMENT_STATUS.PROCESSING);
  });

  it("settles once the second leg lands", async () => {
    const s = await started();
    await PayoutLeg.updateOne(
      { settlementId: s._id, legNumber: 1 },
      { $set: { amount: 1000 } },
    );
    await confirmPayout(admin(), s._id, { utr: "N1" });

    // The admin sends the rest as a second leg.
    await PayoutLeg.create({
      payoutType: PAYOUT_TYPE.SETTLEMENT,
      settlementId: s._id,
      brandId: BRAND,
      legNumber: 2,
      amount: 600,
      status: PAYOUT_LEG_STATUS.INITIATED,
    });

    const second = await confirmPayout(admin(), s._id, { utr: "N2" });

    expect(second.settled).toBe(true);
    expect(second.paidSoFar).toBe(1600);
  });

  it("lets only one of two concurrent confirmations land", async () => {
    const s = await started();

    const results = await Promise.allSettled([
      confirmPayout(admin(), s._id, { utr: "N1" }),
      confirmPayout(admin(), s._id, { utr: "N2" }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  /**
   * ⚠️ `PAID` does **not** release the claimed rows. That money left; it comes
   * back only through `REVERSED`, and only after a `PAYOUT_REVERSAL` entry.
   */
  it("keeps the rows claimed after payment", async () => {
    const s = await started();
    await Transaction.create({
      purpose: "VOUCHER_CLAIM",
      gatewayAccount: "CUSTOMER",
      customerId: oid(),
      brandId: BRAND,
      amount: 810,
      settlementId: s._id,
    });

    await confirmPayout(admin(), s._id, { utr: "N1" });

    expect(await Transaction.countDocuments({ settlementId: s._id })).toBe(1);
  });
});

describe("when the bank bounces it", () => {
  const started = async () => {
    const s = await settlement();
    await startPayout(admin(), s._id);
    return Settlement.findById(s._id).lean();
  };

  it("needs to know what the bank said", async () => {
    const s = await started();
    await expect(failPayout(admin(), s._id, {})).rejects.toThrow(
      /what the bank reported/i,
    );
  });

  it("marks the leg and the settlement failed", async () => {
    const s = await started();

    const result = await failPayout(admin(), s._id, {
      note: "Account closed — NEFT returned",
    });

    expect(result.status).toBe(SETTLEMENT_STATUS.FAILED);
    const leg = await PayoutLeg.findOne({ settlementId: s._id }).lean();
    expect(leg.status).toBe(PAYOUT_LEG_STATUS.FAILED);
    expect(leg.failureReason).toMatch(/account closed/i);
  });

  /**
   * ⚠️ A bounce is ordinary, and the right operation is to fix the account and
   * retry the **same** settlement — keeping its number and its statement.
   * Releasing here would scatter its rows into the next cycle and lose both.
   */
  it("does not release the claimed rows", async () => {
    const s = await started();
    await Transaction.create({
      purpose: "VOUCHER_CLAIM",
      gatewayAccount: "CUSTOMER",
      customerId: oid(),
      brandId: BRAND,
      amount: 810,
      settlementId: s._id,
    });

    await failPayout(admin(), s._id, { note: "bounced" });

    expect(await Transaction.countDocuments({ settlementId: s._id })).toBe(1);
  });

  /**
   * ⚠️ The failed leg is **kept**, not edited. A retry is a new leg, so the
   * record holds both attempts — the one that bounced and the one that worked,
   * each with its own UTR and payee. Editing the first would erase the fact that
   * money was ever sent to that account.
   */
  it("keeps the failed leg and opens a new one on retry", async () => {
    const s = await started();
    await failPayout(admin(), s._id, { note: "Account closed" });

    await retryPayout(admin(), s._id);
    await startPayout(admin(), s._id);

    const legs = await PayoutLeg.find({ settlementId: s._id })
      .sort({ legNumber: 1 })
      .lean();

    expect(legs).toHaveLength(2);
    expect(legs[0].status).toBe(PAYOUT_LEG_STATUS.FAILED);
    expect(legs[0].failureReason).toMatch(/account closed/i);
    expect(legs[1].status).toBe(PAYOUT_LEG_STATUS.INITIATED);
  });

  /**
   * The usual reason a payout bounced is that the account was wrong. Retrying
   * into the same wrong account is the one thing certain not to work.
   */
  it("refreshes the bank details on retry", async () => {
    const s = await started();
    await failPayout(admin(), s._id, { note: "Wrong IFSC" });

    // The vendor fixes their details.
    await Bank.updateOne({ _id: BANK_ID }, { $set: { isDeleted: true } });
    await seedBank({ accountLast4Digits: "4321", maskedAccountNumber: "XXXXXX4321" });

    await retryPayout(admin(), s._id);

    const after = await Settlement.findById(s._id).lean();
    expect(after.status).toBe(SETTLEMENT_STATUS.APPROVED);
    expect(after.bankSnapshot.accountLast4Digits).toBe("4321");
  });

  it("will not retry into an account that is still unverified", async () => {
    const s = await started();
    await failPayout(admin(), s._id, { note: "bounced" });
    await Bank.updateOne({ _id: BANK_ID }, { $set: { isVerified: false } });

    await expect(retryPayout(admin(), s._id)).rejects.toThrow(
      /still has no verified bank account/i,
    );
  });

  it("refuses to retry anything that has not failed", async () => {
    const s = await settlement();
    await expect(retryPayout(admin(), s._id)).rejects.toThrow(
      /only a failed settlement can be retried/i,
    );
  });
});

describe("the trail", () => {
  it("records every step in the settlement's history", async () => {
    const s = await settlement();
    await startPayout(admin(), s._id);
    await confirmPayout(admin(), s._id, { utr: "N123" });

    const rows = await SettlementHistory.find({ settlementId: s._id })
      .sort({ createdAt: 1 })
      .lean();

    expect(rows.map((r) => r.toStatus)).toEqual([
      SETTLEMENT_STATUS.PROCESSING,
      SETTLEMENT_STATUS.PAID,
    ]);
    expect(rows[1].reason).toMatch(/UTR N123/);
  });

  /** A payout is never anonymous. */
  it("records which admin pressed it", async () => {
    const s = await settlement();
    const who = admin();
    await startPayout(who, s._id);

    const leg = await PayoutLeg.findOne({ settlementId: s._id }).lean();
    expect(String(leg.initiatedBy)).toBe(String(who.userId));
  });
});

describe("the leg index does not fire early", () => {
  /**
   * ⚠️ `$type: "objectId"` rather than `sparse: true`. A sparse index still
   * indexes an explicit `null`, so every **refund** leg — which has no
   * `settlementId` — would collide with the next on a rule that was never meant
   * to apply to it. That is the bug the legacy `invoiceId_1` index caused, and
   * it actually fired in 1B.
   */
  it("lets several refund legs with no settlement coexist", async () => {
    const legs = await Promise.all(
      [1, 2, 3].map((n) =>
        PayoutLeg.create({
          payoutType: PAYOUT_TYPE.REFUND,
          refundRequestId: oid(),
          customerId: oid(),
          legNumber: 1,
          amount: 810 * n,
        }),
      ),
    );

    expect(legs).toHaveLength(3);
    expect(legs.every((l) => !l.settlementId)).toBe(true);
  });

  it("still refuses two legs with the same number on one refund", async () => {
    const refundRequestId = oid();
    await PayoutLeg.create({
      payoutType: PAYOUT_TYPE.REFUND,
      refundRequestId,
      customerId: oid(),
      legNumber: 1,
      amount: 810,
    });

    await expect(
      PayoutLeg.create({
        payoutType: PAYOUT_TYPE.REFUND,
        refundRequestId,
        customerId: oid(),
        legNumber: 1,
        amount: 810,
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });
});

/**
 * ⚠️ Split payouts — the branch that could never run.
 *
 * `confirmPayout` has always known how to leave a settlement `PROCESSING` when
 * the legs do not yet add up. It was unreachable: `startPayout` opened every leg
 * at the settlement's full `netPayable`, so confirming a ₹400 NEFT of an ₹800
 * payout recorded ₹800, `paidTotal` cleared the payable, and the settlement
 * closed as `PAID` with half the money never sent. The vendor was short and
 * nothing in the system disagreed.
 *
 * A large MANUAL_BANK payout going out as several NEFTs is ordinary, not exotic
 * — the docs describe it — so this is the case those figures have to survive.
 */
describe("a payout that goes out in more than one NEFT", () => {
  const started = async (overrides = {}) => {
    const s = await settlement(overrides);
    await startPayout(admin(), s._id);
    return Settlement.findById(s._id).lean();
  };

  it("records what actually left, not what the leg was opened for", async () => {
    const s = await started({ netPayable: 800 });

    const result = await confirmPayout(admin(), s._id, {
      utr: "N100000000000001",
      amount: 400,
    });

    expect(result.settled).toBe(false);
    expect(result.paidSoFar).toBe(400);
    expect(result.remaining).toBe(400);

    const leg = await PayoutLeg.findOne({ settlementId: s._id, legNumber: 1 }).lean();
    expect(leg.amount).toBe(400);
  });

  it("leaves the settlement PROCESSING while money is still owed", async () => {
    const s = await started({ netPayable: 800 });

    await confirmPayout(admin(), s._id, { utr: "N100000000000001", amount: 400 });

    expect((await Settlement.findById(s._id).lean()).status).toBe(
      SETTLEMENT_STATUS.PROCESSING,
    );
  });

  /** The second leg is sized to the remainder, never to the whole payable. */
  it("opens the next leg for exactly what is left", async () => {
    const s = await started({ netPayable: 800 });
    await confirmPayout(admin(), s._id, { utr: "N100000000000001", amount: 400 });

    await startPayout(admin(), s._id);

    const second = await PayoutLeg.findOne({
      settlementId: s._id,
      legNumber: 2,
    }).lean();
    expect(second.amount).toBe(400);
  });

  it("marks it paid once the legs add up", async () => {
    const s = await started({ netPayable: 800 });
    await confirmPayout(admin(), s._id, { utr: "N100000000000001", amount: 400 });
    await startPayout(admin(), s._id);

    const result = await confirmPayout(admin(), s._id, {
      utr: "N100000000000002",
      amount: 400,
    });

    expect(result.settled).toBe(true);
    expect(result.remaining).toBe(0);
    expect((await Settlement.findById(s._id).lean()).status).toBe(
      SETTLEMENT_STATUS.PAID,
    );
  });

  /**
   * ⚠️ Two NEFTs for the same money is the thing this must never allow. A leg
   * already in flight has to be confirmed or failed first.
   */
  it("refuses a second leg while one is still in flight", async () => {
    const s = await started({ netPayable: 800 });

    await expect(startPayout(admin(), s._id)).rejects.toThrow(
      /still in flight/i,
    );
  });

  it("refuses an amount larger than the leg was raised for", async () => {
    const s = await started({ netPayable: 800 });

    await expect(
      confirmPayout(admin(), s._id, { utr: "N1", amount: 900 }),
    ).rejects.toThrow(/what actually left the bank|second leg/i);
  });

  /** Omitting the amount still means "all of it" — the ordinary case. */
  it("still treats a plain confirmation as the whole leg", async () => {
    const s = await started({ netPayable: 800 });

    const result = await confirmPayout(admin(), s._id, {
      utr: "N100000000000001",
    });

    expect(result.settled).toBe(true);
    expect(result.paidSoFar).toBe(800);
  });

  it("will not open a leg on a settlement already paid in full", async () => {
    const s = await started({ netPayable: 800 });
    await confirmPayout(admin(), s._id, { utr: "N100000000000001" });

    await expect(startPayout(admin(), s._id)).rejects.toThrow(
      /is (paid|already been paid)/i,
    );
  });
});
