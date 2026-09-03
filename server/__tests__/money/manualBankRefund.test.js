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
const RefundRequest = require("../../models/RefundRequest");
const PayoutLeg = require("../../models/PayoutLeg");
const LedgerEntry = require("../../models/LedgerEntry");
const CustomerBankAccount = require("../../models/CustomerBankAccount");

const {
  requestBankDetails,
  attachBankToRefund,
  payRefundToBank,
  confirmRefundPayout,
  failRefundPayout,
} = require("../../services/refunds");

const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");
const { VOUCHER_CLAIM_STATUS } = require("../../constants/voucherClaim");
const {
  REFUND_REQUEST_STATUS,
  REFUND_REASON,
} = require("../../constants/refund");
const { REFUND_METHODS } = require("../../constants/customer");
const { PAYOUT_TYPE, PAYOUT_LEG_STATUS } = require("../../constants/payout");
const { ROLES, PAYMENT_STATUS } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();

let CUSTOMER;
let BRAND;
let txn;
let request;
let account;

const admin = () => ({ _id: oid(), role: ROLES.ADMIN });
const customer = () => ({ customerId: CUSTOMER, role: ROLES.CUSTOMER });

const COLLECTIONS = [
  Transaction,
  VoucherClaim,
  VoucherClaimHistory,
  VoucherUsage,
  RefundRequest,
  PayoutLeg,
  LedgerEntry,
  CustomerBankAccount,
];

/** A refund whose `SOURCE` attempt has already failed — the only way in. */
const seed = async ({ verifiedAccount = true } = {}) => {
  const claimId = oid();

  txn = await Transaction.create({
    purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
    gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
    customerId: CUSTOMER,
    brandId: BRAND,
    subBrandId: oid(),
    amount: 810,
    paidAmount: 810,
    amountRefunded: 0,
    gatewayFee: 17.94,
    status: PAYMENT_STATUS.CAPTURED,
    verified: true,
    razorpayPaymentId: `pay_${Math.random().toString(36).slice(2, 12)}`,
    settlementHold: true,
    voucher: { claimId, billAmount: 1000, netBill: 800 },
  });

  await VoucherClaim.create({
    _id: claimId,
    customerId: CUSTOMER,
    voucherId: oid(),
    voucherVersionId: oid(),
    versionNumber: 1,
    brandId: BRAND,
    subBrandId: txn.subBrandId,
    billAmount: 1000,
    pricing: { netBill: 800, convenienceFee: 10, totalPayable: 810 },
    transactionId: txn._id,
    status: VOUCHER_CLAIM_STATUS.REDEEMED,
    claimCode: `TD-MB-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
  });

  request = await RefundRequest.create({
    transactionId: txn._id,
    claimId,
    customerId: CUSTOMER,
    brandId: BRAND,
    claimCode: "TD-MB-0001",
    requestedAmount: 810,
    approvedAmount: 810,
    reason: REFUND_REASON.OTHER,
    reasonNote: "card closed",
    // Where a MANUAL_BANK story always starts: SOURCE tried, and could not.
    status: REFUND_REQUEST_STATUS.FAILED,
    attemptCount: 1,
    split: { totalRefund: 810, vendorClawback: 800, convenienceFeeRefund: 10 },
  });

  account = await CustomerBankAccount.create({
    customerId: CUSTOMER,
    accountHolderName: "A Customer",
    accountNumber: "123456789012",
    maskedAccountNumber: "********9012",
    accountLast4Digits: "9012",
    ifscCode: "HDFC0001234",
    bankName: "HDFC Bank",
    isVerified: verifiedAccount,
    verifiedAt: verifiedAccount ? new Date() : null,
  });
};

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
  CUSTOMER = oid();
  BRAND = oid();
  await seed();
});

describe("asking the customer for an account", () => {
  it("moves a failed refund to awaiting, and keeps it open", async () => {
    const result = await requestBankDetails(admin(), request._id, {
      reason: "The card used to pay has been closed",
    });

    expect(result.status).toBe(REFUND_REQUEST_STATUS.AWAITING_BANK_DETAILS);
    expect(result.method).toBe(REFUND_METHODS.MANUAL_BANK);
    expect(result.bankDetailsRequestedAt).toBeTruthy();
    /**
     * ⚠️ The property everything else rests on.
     *
     * `isOpen` is derived from `REFUND_OPEN_STATUSES` by a `pre("save")` hook
     * that does **not** run on `findOneAndUpdate`. A stale `false` here would
     * free the `(transactionId, isOpen)` slot and let the customer file a second
     * refund on the same payment — and `releaseSettlementHold` would count no
     * open request and let the vendor be paid for a sale still owed back.
     */
    expect(result.isOpen).toBe(true);
  });

  it("will not ask before the original method has actually failed", async () => {
    await RefundRequest.updateOne(
      { _id: request._id },
      { $set: { status: REFUND_REQUEST_STATUS.ADMIN_APPROVED } },
    );

    await expect(
      requestBankDetails(admin(), request._id, { reason: "card closed" }),
    ).rejects.toThrow(/only asked for after a refund .* has failed/i);
  });

  it("needs a reason support can quote back", async () => {
    await expect(
      requestBankDetails(admin(), request._id, { reason: "x" }),
    ).rejects.toThrow(/reason is required/i);
  });

  it("is not something a customer can do", async () => {
    await expect(
      requestBankDetails(customer(), request._id, { reason: "card closed" }),
    ).rejects.toThrow(/only trydood/i);
  });
});

describe("the customer chooses where it goes", () => {
  beforeEach(async () => {
    await requestBankDetails(admin(), request._id, { reason: "card closed" });
  });

  it("attaches a verified account and puts it back in the payout queue", async () => {
    const result = await attachBankToRefund(customer(), request._id, {
      bankAccountId: account._id,
    });

    /**
     * Back to approved, not to FAILED. The decision to refund was made long ago
     * and has not changed — only the destination has. Landing on FAILED would
     * queue it for another `SOURCE` attempt, the one thing known not to work.
     */
    expect(result.status).toBe(REFUND_REQUEST_STATUS.ADMIN_APPROVED);
    expect(String(result.customerBankAccountId)).toBe(String(account._id));
    expect(result.isOpen).toBe(true);
  });

  /**
   * ⚠️ A penny drop can fail on an account that exists — closed, frozen, or a
   * name that does not match. An unverified row is a record that somebody tried,
   * never a destination: a NEFT into one cannot be recalled.
   */
  it("refuses an account the bank never confirmed", async () => {
    await CustomerBankAccount.updateOne(
      { _id: account._id },
      { $set: { isVerified: false } },
    );

    await expect(
      attachBankToRefund(customer(), request._id, { bankAccountId: account._id }),
    ).rejects.toThrow(/has not been verified/i);
  });

  it("refuses an account belonging to somebody else", async () => {
    const theirs = await CustomerBankAccount.create({
      customerId: oid(),
      accountHolderName: "Someone Else",
      accountNumber: "999888777666",
      maskedAccountNumber: "********7666",
      accountLast4Digits: "7666",
      ifscCode: "HDFC0001234",
      isVerified: true,
    });

    await expect(
      attachBankToRefund(customer(), request._id, { bankAccountId: theirs._id }),
    ).rejects.toThrow(/not found/i);
  });

  it("refuses a refund that is not the caller's", async () => {
    await expect(
      attachBankToRefund(
        { customerId: oid(), role: ROLES.CUSTOMER },
        request._id,
        { bankAccountId: account._id },
      ),
    ).rejects.toThrow(/not yours/i);
  });
});

describe("paying it out by hand", () => {
  beforeEach(async () => {
    await requestBankDetails(admin(), request._id, { reason: "card closed" });
    await attachBankToRefund(customer(), request._id, {
      bankAccountId: account._id,
    });
  });

  it("opens a leg with the payee frozen onto it", async () => {
    const { request: moved, leg } = await payRefundToBank(admin(), request._id);

    expect(moved.status).toBe(REFUND_REQUEST_STATUS.PROCESSING);
    expect(moved.isOpen).toBe(true);
    expect(leg.payoutType).toBe(PAYOUT_TYPE.REFUND);
    expect(leg.status).toBe(PAYOUT_LEG_STATUS.INITIATED);
    expect(leg.amount).toBe(810);
    /**
     * Frozen at the moment the money is committed. The account row can change
     * later; what matters in a dispute is where this transfer actually went.
     */
    expect(leg.bankSnapshot.accountLast4Digits).toBe("9012");
    expect(leg.bankSnapshot.ifscCode).toBe("HDFC0001234");
  });

  it("refuses a second payout while one is already in flight", async () => {
    await payRefundToBank(admin(), request._id);

    await expect(payRefundToBank(admin(), request._id)).rejects.toThrow(
      /cannot be paid yet|already/i,
    );
  });

  it("will not pay before the customer has chosen an account", async () => {
    await RefundRequest.updateOne(
      { _id: request._id },
      { $unset: { customerBankAccountId: "" } },
    );

    await expect(payRefundToBank(admin(), request._id)).rejects.toThrow(
      /has not chosen a bank account/i,
    );
  });

  /**
   * ⚠️ Re-checked at pay time, not trusted from the attach: hours pass in
   * between, and an account can be removed or fail a re-verification.
   */
  it("will not pay into an account that stopped being verified", async () => {
    await CustomerBankAccount.updateOne(
      { _id: account._id },
      { $set: { isVerified: false } },
    );

    await expect(payRefundToBank(admin(), request._id)).rejects.toThrow(
      /no longer verified/i,
    );
  });
});

describe("confirming and failing the transfer", () => {
  beforeEach(async () => {
    await requestBankDetails(admin(), request._id, { reason: "card closed" });
    await attachBankToRefund(customer(), request._id, {
      bankAccountId: account._id,
    });
    await payRefundToBank(admin(), request._id);
  });

  it("closes the refund once the UTR is in", async () => {
    const { leg } = await confirmRefundPayout(admin(), request._id, {
      utr: "N123456789012345",
    });

    expect(leg.status).toBe(PAYOUT_LEG_STATUS.PAID);
    expect(leg.utr).toBe("N123456789012345");

    const after = await RefundRequest.findById(request._id).lean();
    expect(after.status).toBe(REFUND_REQUEST_STATUS.COMPLETED);
    expect(after.isOpen).toBe(false);

    // The payment now knows the money went back.
    const payment = await Transaction.findById(txn._id).lean();
    expect(payment.amountRefunded).toBe(810);
  });

  /**
   * ⚠️ Three days later, when the customer says the money never arrived, the
   * UTR is the only thing that can be looked up on a bank statement.
   */
  it("refuses to confirm without a bank reference", async () => {
    await expect(
      confirmRefundPayout(admin(), request._id, { utr: "" }),
    ).rejects.toThrow(/UTR\) is required/i);
  });

  it("lets only one of two admins confirm", async () => {
    await confirmRefundPayout(admin(), request._id, { utr: "N1111" });

    await expect(
      confirmRefundPayout(admin(), request._id, { utr: "N2222" }),
    ).rejects.toThrow(/no payout to confirm|already/i);
  });

  /**
   * ⚠️ A bounced leg is **kept**, never edited. Both attempts survive with their
   * own payee — a rewritten record erases that money was once sent to an
   * account, which is exactly what an audit needs to see.
   */
  it("keeps the bounced leg and leaves the refund open", async () => {
    const after = await failRefundPayout(admin(), request._id, {
      reason: "Account closed at the bank",
    });

    expect(after.status).toBe(REFUND_REQUEST_STATUS.FAILED);
    expect(after.isOpen).toBe(true);

    const legs = await PayoutLeg.find({ refundRequestId: request._id }).lean();
    expect(legs).toHaveLength(1);
    expect(legs[0].status).toBe(PAYOUT_LEG_STATUS.FAILED);
    expect(legs[0].failureReason).toMatch(/account closed/i);
  });

  it("opens a fresh leg on a retry rather than reusing the old one", async () => {
    await failRefundPayout(admin(), request._id, { reason: "bounced" });
    const { leg } = await payRefundToBank(admin(), request._id);

    expect(leg.legNumber).toBe(2);

    const legs = await PayoutLeg.find({ refundRequestId: request._id })
      .sort({ legNumber: 1 })
      .lean();
    expect(legs).toHaveLength(2);
    expect(legs[0].status).toBe(PAYOUT_LEG_STATUS.FAILED);
    expect(legs[1].status).toBe(PAYOUT_LEG_STATUS.INITIATED);
  });
});

/**
 * ⚠️ The vendor's money must stay held for every step of this.
 *
 * The whole reason `MANUAL_BANK` exists is that the customer has **not** been
 * paid back. If the hold came off anywhere along the way, the next settlement
 * would pay the vendor for a sale that is still owed a refund — silently,
 * because the eligibility predicate simply stops matching.
 */
describe("the settlement hold, all the way through", () => {
  it("stays on from the failure to the moment the money lands", async () => {
    const held = async () =>
      (await Transaction.findById(txn._id).select("settlementHold").lean())
        .settlementHold;

    expect(await held()).toBe(true);

    await requestBankDetails(admin(), request._id, { reason: "card closed" });
    expect(await held()).toBe(true);

    await attachBankToRefund(customer(), request._id, {
      bankAccountId: account._id,
    });
    expect(await held()).toBe(true);

    await payRefundToBank(admin(), request._id);
    expect(await held()).toBe(true);

    await confirmRefundPayout(admin(), request._id, { utr: "N999" });
    // Still held after a full refund — that money was never the vendor's.
    expect(await held()).toBe(true);
  });
});

/**
 * ⚠️ `AWAITING_BANK_DETAILS` was the one open refund state with nothing watching
 * it.
 *
 * Every other one has a job that eventually resolves it. This one cannot: only
 * the customer can move it, and some never will. Meanwhile `settlementHold` keeps
 * that payment out of **every** settlement — so the cost of a customer's silence
 * lands on the vendor, indefinitely, and nothing was ever going to notice.
 */
describe("nudging a customer who never answered", () => {
  const { remindCustomersAboutBankDetails } = require("../../services/refunds");
  const { releaseTransactionHold } = require("../../services/transactions");

  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  /** Rewind the ask, so a wait of days does not take days. */
  const askedAgo = async (ms) =>
    RefundRequest.updateOne(
      { _id: request._id },
      { $set: { bankDetailsRequestedAt: new Date(Date.now() - ms) } },
    );

  const stageOn = async () =>
    (await RefundRequest.findById(request._id).select("bankDetailsRemindersSent").lean())
      .bankDetailsRemindersSent;

  beforeEach(async () => {
    await requestBankDetails(admin(), request._id, { reason: "card closed" });
  });

  it("says nothing in the first day", async () => {
    const result = await remindCustomersAboutBankDetails();

    expect(result.reminded).toBe(0);
    expect(await stageOn()).toBe(0);
  });

  it("nudges once the first mark passes", async () => {
    await askedAgo(30 * HOUR);

    const result = await remindCustomersAboutBankDetails();

    expect(result.reminded).toBe(1);
    expect(await stageOn()).toBe(1);
  });

  /**
   * ⚠️ The job runs hourly. A stage that re-sent every sweep would put the same
   * message in front of somebody 24 times a day — about money they are owed,
   * asking for bank details. That reads as a scam, not a service.
   */
  it("does not repeat a nudge it has already sent", async () => {
    await askedAgo(30 * HOUR);
    await remindCustomersAboutBankDetails();

    const second = await remindCustomersAboutBankDetails();

    expect(second.reminded).toBe(0);
    expect(await stageOn()).toBe(1);
  });

  it("sends the second nudge only after the second mark", async () => {
    await askedAgo(100 * HOUR);

    const result = await remindCustomersAboutBankDetails();
    expect(result.reminded).toBe(1);
    expect(await stageOn()).toBe(1);

    // Same sweep does not fire twice; the next one carries the second stage.
    const next = await remindCustomersAboutBankDetails();
    expect(next.reminded).toBe(1);
    expect(await stageOn()).toBe(2);
  });

  it("hands a long-silent refund to an admin", async () => {
    await askedAgo(31 * DAY);
    await RefundRequest.updateOne(
      { _id: request._id },
      { $set: { bankDetailsRemindersSent: 2 } },
    );

    const result = await remindCustomersAboutBankDetails();

    expect(result.escalated).toBe(1);
    expect(result.reminded).toBe(0);
    expect(await stageOn()).toBe(3);
  });

  /**
   * ⚠️ Without this the sweep never drains: `AWAITING_BANK_DETAILS` only leaves
   * when the customer acts, so every unanswered refund would be re-read every
   * hour for ever and the batch would fill with rows there is nothing left to
   * say to.
   */
  it("stops looking once every stage is used up", async () => {
    await askedAgo(60 * DAY);
    await RefundRequest.updateOne(
      { _id: request._id },
      { $set: { bankDetailsRemindersSent: 3 } },
    );

    const result = await remindCustomersAboutBankDetails();

    expect(result.reminded).toBe(0);
    expect(result.escalated).toBe(0);
  });

  it("says nothing to a customer who answered in the meantime", async () => {
    await askedAgo(30 * HOUR);
    await attachBankToRefund(customer(), request._id, {
      bankAccountId: account._id,
    });

    const result = await remindCustomersAboutBankDetails();

    expect(result.reminded).toBe(0);
  });
});

/**
 * The escape hatch, and the guard on it.
 *
 * ⚠️ Releasing the hold does **not** cancel the refund. The money stays owed and
 * the request stays open; if the customer ever does answer,
 * `claimRefundAdjustments` recovers the clawback from a later cycle, because by
 * then the payment carries a `settlementId`. Nothing is written off — the vendor
 * simply stops paying for someone else's silence.
 */
describe("releasing the vendor's hold after a long silence", () => {
  const { releaseTransactionHold } = require("../../services/transactions");

  const DAY = 24 * 60 * 60 * 1000;

  const askedAgo = async (ms) =>
    RefundRequest.updateOne(
      { _id: request._id },
      { $set: { bankDetailsRequestedAt: new Date(Date.now() - ms) } },
    );

  beforeEach(async () => {
    await requestBankDetails(admin(), request._id, { reason: "card closed" });
  });

  it("refuses while the refund could still complete on its own", async () => {
    await askedAgo(2 * DAY);

    await expect(
      releaseTransactionHold(admin(), txn._id, { reason: "vendor chased us" }),
    ).rejects.toThrow(/waiting on the customer's bank details/i);

    const payment = await Transaction.findById(txn._id).lean();
    expect(payment.settlementHold).toBe(true);
  });

  it("allows it once the wait is genuinely stale", async () => {
    await askedAgo(31 * DAY);

    await releaseTransactionHold(admin(), txn._id, {
      reason: "Customer unreachable for a month; unfreezing the vendor",
    });

    const payment = await Transaction.findById(txn._id).lean();
    expect(payment.settlementHold).toBe(false);

    // ⚠️ And the refund is still owed — releasing the hold is not a write-off.
    const after = await RefundRequest.findById(request._id).lean();
    expect(after.status).toBe(REFUND_REQUEST_STATUS.AWAITING_BANK_DETAILS);
    expect(after.isOpen).toBe(true);
  });

  /**
   * ⚠️ Written as "the release refuses when a second refund is open", and the
   * database refused to set that up at all — which is the better answer.
   *
   * `refund_open_per_transaction_unique` is partial on `(transactionId, isOpen)`,
   * so a payment can carry **one** open refund and no more. The override above
   * therefore cannot be tricked by a second request appearing beside the stalled
   * one; there is no way to create it.
   *
   * That guarantee is what lets `exceptRequestId` name a single row and stay
   * safe: excluding the one open refund cannot silently be excluding several.
   */
  it("cannot have a second open refund on the same payment at all", async () => {
    await askedAgo(31 * DAY);

    await expect(
      RefundRequest.create({
        transactionId: txn._id,
        claimId: request.claimId,
        customerId: CUSTOMER,
        brandId: BRAND,
        claimCode: "TD-MB-0002",
        requestedAmount: 10,
        reason: REFUND_REASON.OTHER,
        reasonNote: "second",
        status: REFUND_REQUEST_STATUS.REQUESTED,
      }),
    ).rejects.toThrow(/duplicate key|E11000/i);
  });
});
