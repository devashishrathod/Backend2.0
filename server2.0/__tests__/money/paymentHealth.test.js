const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const VoucherClaim = require("../../models/VoucherClaim");
const JobLock = require("../../models/JobLock");
const RefundRequest = require("../../models/RefundRequest");
const { getPaymentHealth } = require("../../services/transactions");
const { getJobRegistry } = require("../../jobs");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
  SETTLEMENT_STAGE,
  PAYMENT_HEALTH_STATUS,
} = require("../../constants/transaction");
const { VOUCHER_CLAIM_STATUS } = require("../../constants/voucherClaim");
const {
  REFUND_REQUEST_STATUS,
  REFUND_REASON,
} = require("../../constants/refund");
const { PAYMENT_STATUS } = require("../../constants");

const oid = () => new mongoose.Types.ObjectId();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(Date.now() - ms);

/**
 * Make every job look like it ran a moment ago.
 *
 * Without this the runner has never run on the test database, which is itself
 * an ATTENTION condition — correctly so, but it would mask the money conditions
 * these tests are actually about.
 */
const seedHealthyJobs = async () => {
  const now = new Date();
  await JobLock.collection.insertMany(
    getJobRegistry().map((job) => ({
      _id: job.name,
      intervalMinutes: job.intervalMinutes || 60,
      lastRunAt: now,
      lastSuccessfulRunAt: now,
      consecutiveFailures: 0,
    })),
  );
};

const claimPayment = (overrides = {}) => ({
  purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
  gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
  customerId: oid(),
  brandId: oid(),
  amount: 810,
  ...overrides,
});

beforeAll(async () => {
  await connectTestDb();
  for (const m of [Transaction, VoucherClaim, JobLock, RefundRequest]) {
    await m.createIndexes();
  }
});

afterAll(async () => {
  await clearCollections(Transaction, VoucherClaim, JobLock, RefundRequest);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(Transaction, VoucherClaim, JobLock, RefundRequest);
  await seedHealthyJobs();
});

describe("a quiet system reports quiet", () => {
  it("is OK with nothing stuck", async () => {
    const health = await getPaymentHealth();
    expect(health.status).toBe(PAYMENT_HEALTH_STATUS.OK);
    expect(health.stuck).toEqual({
      interruptedSettles: 0,
      stuckAuthorizations: 0,
      stalePendingClaims: 0,
      openDisputes: 0,
      disputesDueSoon: 0,
      unsettledCaptures: 0,
      stuckFailedRefunds: 0,
      stuckProcessingRefunds: 0,
      unattendedEscalations: 0,
      stalledApprovals: 0,
      unheldRefunds: 0,
      frozenHolds: 0,
      unconfirmedPayouts: 0,
      overdueSettlements: 0,
      strandedDrafts: 0,
    });
  });

  /**
   * A payment taken thirty seconds ago is not stuck, it is in flight. Without a
   * grace window every checkout in progress would light the board red, and a
   * board that is always red is a board nobody reads.
   */
  it("does not call a payment in flight stuck", async () => {
    await Transaction.create(
      claimPayment({
        status: PAYMENT_STATUS.AUTHORIZED,
        verified: false,
        createdAt: new Date(),
      }),
    );
    await VoucherClaim.create({
      customerId: oid(),
      voucherId: oid(),
      voucherVersionId: oid(),
      versionNumber: 1,
      brandId: oid(),
      subBrandId: oid(),
      billAmount: 1000,
      pricing: { billAmount: 1000, totalPayable: 810, amountInPaise: 81000 },
      status: VOUCHER_CLAIM_STATUS.PENDING,
      holdsUsageSlot: true,
      createdAt: new Date(),
    });

    const health = await getPaymentHealth();
    expect(health.stuck.stuckAuthorizations).toBe(0);
    expect(health.stuck.stalePendingClaims).toBe(0);
    expect(health.status).toBe(PAYMENT_HEALTH_STATUS.OK);
  });
});

describe("what loses money on a timer is CRITICAL", () => {
  /**
   * ⚠️ An `authorized` payment that is never captured is auto-refunded by
   * Razorpay after about five days. The customer's money goes back, the claim
   * stays unpaid, and nobody notices until the vendor asks where the sale went.
   */
  it("flags an authorization nobody captured", async () => {
    await Transaction.create(
      claimPayment({
        status: PAYMENT_STATUS.AUTHORIZED,
        verified: false,
        createdAt: ago(3 * HOUR),
      }),
    );

    const health = await getPaymentHealth();
    expect(health.stuck.stuckAuthorizations).toBe(1);
    expect(health.status).toBe(PAYMENT_HEALTH_STATUS.CRITICAL);
  });

  /**
   * A dispute deadline missed forfeits the money by default — the loss happens
   * with no decision ever taken, which is why it is a different alarm from
   * "a dispute is open".
   */
  it("flags a dispute whose deadline is close", async () => {
    await Transaction.create(
      claimPayment({
        verified: true,
        settlementStage: SETTLEMENT_STAGE.COMPLETE,
        isDisputed: true,
        disputeRespondBy: new Date(Date.now() + DAY),
      }),
    );

    const health = await getPaymentHealth();
    expect(health.stuck.disputesDueSoon).toBe(1);
    expect(health.stuck.openDisputes).toBe(1);
    expect(health.status).toBe(PAYMENT_HEALTH_STATUS.CRITICAL);
  });

  it("does not treat a far-off deadline as urgent", async () => {
    await Transaction.create(
      claimPayment({
        verified: true,
        settlementStage: SETTLEMENT_STAGE.COMPLETE,
        isDisputed: true,
        disputeRespondBy: new Date(Date.now() + 20 * DAY),
      }),
    );

    const health = await getPaymentHealth();
    expect(health.stuck.disputesDueSoon).toBe(0);
    expect(health.stuck.openDisputes).toBe(1);
    // Real, but it waits for a human without getting worse.
    expect(health.status).toBe(PAYMENT_HEALTH_STATUS.ATTENTION);
  });

  it("stops counting a dispute once it is resolved", async () => {
    await Transaction.create(
      claimPayment({
        verified: true,
        settlementStage: SETTLEMENT_STAGE.COMPLETE,
        isDisputed: true,
        disputeRespondBy: new Date(Date.now() + DAY),
        disputeResolvedAt: new Date(),
      }),
    );

    const health = await getPaymentHealth();
    expect(health.stuck.openDisputes).toBe(0);
    expect(health.stuck.disputesDueSoon).toBe(0);
  });
});

describe("what waits for a human is ATTENTION", () => {
  /**
   * A capture that claimed the row and then died partway. Every step after the
   * conditional claim is idempotent, so `resumeIncompleteSettlements` simply
   * runs them again — a count that stays above zero means that job is not
   * working, which is why it sits next to the job list.
   */
  it("flags a settle that never finished", async () => {
    await Transaction.create(
      claimPayment({
        verified: true,
        settlementStage: SETTLEMENT_STAGE.RECORDED,
      }),
    );

    const health = await getPaymentHealth();
    expect(health.stuck.interruptedSettles).toBe(1);
    expect(health.status).toBe(PAYMENT_HEALTH_STATUS.ATTENTION);
  });

  /**
   * The usage slot is taken when the claim is created, not when it is paid —
   * that is what closes the race. The cost is that an abandoned checkout holds
   * it until the sweep runs, and the customer is told "you have already used
   * this offer" about a claim they never paid for.
   */
  it("flags a slot held by an abandoned checkout", async () => {
    await VoucherClaim.create({
      customerId: oid(),
      voucherId: oid(),
      voucherVersionId: oid(),
      versionNumber: 1,
      brandId: oid(),
      subBrandId: oid(),
      billAmount: 1000,
      pricing: { billAmount: 1000, totalPayable: 810, amountInPaise: 81000 },
      status: VOUCHER_CLAIM_STATUS.PENDING,
      holdsUsageSlot: true,
      createdAt: ago(5 * HOUR),
    });

    const health = await getPaymentHealth();
    expect(health.stuck.stalePendingClaims).toBe(1);
    expect(health.status).toBe(PAYMENT_HEALTH_STATUS.ATTENTION);
  });

  it("flags money captured long ago and never paid out", async () => {
    await Transaction.create(
      claimPayment({
        verified: true,
        settlementStage: SETTLEMENT_STAGE.COMPLETE,
        createdAt: ago(15 * DAY),
      }),
    );

    const health = await getPaymentHealth();
    expect(health.stuck.unsettledCaptures).toBe(1);
    expect(health.status).toBe(PAYMENT_HEALTH_STATUS.ATTENTION);
  });

  /**
   * A row on hold is not unpaid by accident — it is unpaid on purpose, because
   * a refund or a dispute is pending against it. Counting it would make the
   * board red for exactly the rows the process is handling correctly.
   */
  it("does not flag money deliberately held back", async () => {
    const txn = await Transaction.create(
      claimPayment({
        verified: true,
        settlementStage: SETTLEMENT_STAGE.COMPLETE,
        settlementHold: true,
        settlementHoldReason: "Refund requested",
        createdAt: ago(15 * DAY),
      }),
    );

    /**
     * ⚠️ The refund the hold is *for*, which this fixture used to leave out.
     *
     * Its own description says the row is "unpaid on purpose, because a refund
     * or a dispute is pending against it" — and nothing pending was ever
     * created. A hold with nothing behind it is not deliberate, it is the
     * silent freeze `frozenHolds` was added to find, and it was right to flag
     * this.
     */
    await RefundRequest.create({
      claimId: oid(),
      transactionId: txn._id,
      customerId: oid(),
      brandId: txn.brandId,
      claimCode: "TD-HLD001",
      requestedAmount: 100,
      reason: REFUND_REASON.OTHER,
      status: REFUND_REQUEST_STATUS.REQUESTED,
    });

    const health = await getPaymentHealth();
    expect(health.stuck.unsettledCaptures).toBe(0);
    expect(health.stuck.frozenHolds).toBe(0);
    expect(health.status).toBe(PAYMENT_HEALTH_STATUS.OK);
  });

  /**
   * ⚠️ The inverse, and the one nobody was watching.
   *
   * A payment held with no open refund and no live dispute is money the vendor
   * will never see: the eligibility predicate simply stops matching, with no
   * error and no complaint, because nobody knows to complain.
   */
  it("flags a hold with nothing behind it", async () => {
    await Transaction.create(
      claimPayment({
        verified: true,
        settlementStage: SETTLEMENT_STAGE.COMPLETE,
        settlementHold: true,
        settlementHoldReason: "Chargeback WON (disp_1)",
        createdAt: ago(15 * DAY),
        updatedAt: ago(2 * DAY),
      }),
    );

    const health = await getPaymentHealth();
    expect(health.stuck.frozenHolds).toBe(1);
    expect(health.status).toBe(PAYMENT_HEALTH_STATUS.ATTENTION);
  });

  it("does not flag money already paid out", async () => {
    await Transaction.create(
      claimPayment({
        verified: true,
        settlementStage: SETTLEMENT_STAGE.COMPLETE,
        settlementId: oid(),
        createdAt: ago(15 * DAY),
      }),
    );

    const health = await getPaymentHealth();
    expect(health.stuck.unsettledCaptures).toBe(0);
  });
});

describe("the runner itself is part of the answer", () => {
  /**
   * `startJobs` runs every job once at boot, so `NEVER_RUN` surviving means the
   * runner did not start — and then none of the safety nets above exist either.
   * A brand-new instance with no job runner reporting a confident OK is exactly
   * the failure this line prevents.
   */
  it("does not report OK when no job has ever run", async () => {
    await JobLock.deleteMany({});

    const health = await getPaymentHealth();
    expect(health.jobs.registered).toBe(getJobRegistry().length);
    expect(health.status).toBe(PAYMENT_HEALTH_STATUS.ATTENTION);
  });
});

describe("it counts only the flow it claims to", () => {
  /**
   * One collection holds vendor subscriptions and customer voucher claims. A
   * health page that mixed them would report a vendor's own unpaid invoice as
   * stuck customer money.
   */
  it("ignores subscription payments entirely", async () => {
    await Transaction.create({
      purpose: TRANSACTION_PURPOSE.SUBSCRIPTION,
      gatewayAccount: RAZORPAY_ACCOUNTS.VENDOR,
      brandId: oid(),
      amount: 4999,
      status: PAYMENT_STATUS.AUTHORIZED,
      verified: false,
      createdAt: ago(10 * DAY),
    });

    const health = await getPaymentHealth();
    expect(health.stuck.stuckAuthorizations).toBe(0);
    expect(health.stuck.unsettledCaptures).toBe(0);
    expect(health.status).toBe(PAYMENT_HEALTH_STATUS.OK);
  });

  it("ignores a soft-deleted row", async () => {
    await Transaction.create(
      claimPayment({
        status: PAYMENT_STATUS.AUTHORIZED,
        verified: false,
        createdAt: ago(3 * HOUR),
        isDeleted: true,
      }),
    );

    const health = await getPaymentHealth();
    expect(health.stuck.stuckAuthorizations).toBe(0);
  });
});

describe("the index guarantee is reported, not assumed", () => {
  /**
   * ⚠️ Something outside this build keeps recreating `invoiceId_1` and
   * `razorpayOrderId_1` — blanket unique indexes that reject the *second* row
   * with no value. In production that rejects every second voucher claim. It is
   * reported at boot too, but a boot log scrolls away and this page does not.
   */
  it("carries the index check into the answer", async () => {
    const health = await getPaymentHealth();
    expect(health.indexes).toHaveProperty("ok");
    expect(typeof health.indexes.ok).toBe("boolean");
  });

  it("stamps when it looked, so a stale page is obvious", async () => {
    const health = await getPaymentHealth();
    expect(health.checkedAt).toBeInstanceOf(Date);
    expect(Date.now() - health.checkedAt.getTime()).toBeLessThan(60_000);
  });
});

describe("refunds that nobody has moved", () => {
  /**
   * `status` is set after creation because the `pre("save")` hook derives
   * `isOpen` from it — creating straight into a terminal state is a shape the
   * real flow never produces.
   */
  const seedRefund = async ({ status, failedAt, initiatedAt, updatedAt }) => {
    const doc = await RefundRequest.create({
      claimId: oid(),
      transactionId: oid(),
      customerId: oid(),
      brandId: oid(),
      claimCode: "TD-ACD349",
      requestedAmount: 810,
      reason: REFUND_REASON.NOT_HONOURED,
      ...(failedAt ? { failedAt } : {}),
      ...(initiatedAt ? { initiatedAt } : {}),
    });
    doc.status = status;
    await doc.save();
    if (updatedAt) {
      await RefundRequest.collection.updateOne(
        { _id: doc._id },
        { $set: { updatedAt } },
      );
    }
    return doc;
  };

  /**
   * ⚠️ CRITICAL, and for the mirror image of the reason an uncaptured
   * authorization is: a customer's money is being **held** and nothing automated
   * will release it. `SOURCE` is the only automated path and it has already
   * failed, usually because the instrument cannot accept a refund at all.
   */
  it("flags a failed refund nobody has picked up", async () => {
    await seedRefund({
      status: REFUND_REQUEST_STATUS.FAILED,
      failedAt: ago(3 * DAY),
    });

    const health = await getPaymentHealth();
    expect(health.stuck.stuckFailedRefunds).toBe(1);
    expect(health.status).toBe(PAYMENT_HEALTH_STATUS.CRITICAL);
  });

  it("gives a fresh failure a day before calling it stuck", async () => {
    await seedRefund({
      status: REFUND_REQUEST_STATUS.FAILED,
      failedAt: new Date(),
    });

    const health = await getPaymentHealth();
    expect(health.stuck.stuckFailedRefunds).toBe(0);
    expect(health.status).toBe(PAYMENT_HEALTH_STATUS.OK);
  });

  /**
   * `reconcileRefunds` asks Razorpay every 30 minutes, so a count above zero
   * means that job is not working — not that a bank is slow.
   */
  it("flags one that left for Razorpay and never came back", async () => {
    await seedRefund({
      status: REFUND_REQUEST_STATUS.PROCESSING,
      initiatedAt: ago(5 * DAY),
    });

    const health = await getPaymentHealth();
    expect(health.stuck.stuckProcessingRefunds).toBe(1);
    // Real, but it waits for a human without getting worse.
    expect(health.status).toBe(PAYMENT_HEALTH_STATUS.ATTENTION);
  });

  /**
   * Escalation moves a request to an admin; it does not decide it. A customer
   * who sat out a vendor window and is now sitting out ours has been waiting
   * two full windows for anyone at all to look.
   */
  it("flags an escalation nobody has looked at", async () => {
    await seedRefund({
      status: REFUND_REQUEST_STATUS.VENDOR_TIMEOUT,
      updatedAt: ago(3 * DAY),
    });

    const health = await getPaymentHealth();
    expect(health.stuck.unattendedEscalations).toBe(1);
    expect(health.status).toBe(PAYMENT_HEALTH_STATUS.ATTENTION);
  });

  it("does not count a refund that completed normally", async () => {
    await seedRefund({ status: REFUND_REQUEST_STATUS.COMPLETED });

    const health = await getPaymentHealth();
    expect(health.stuck.stuckFailedRefunds).toBe(0);
    expect(health.stuck.stuckProcessingRefunds).toBe(0);
    expect(health.status).toBe(PAYMENT_HEALTH_STATUS.OK);
  });
});

describe("the two states nothing else was watching", () => {
  const seedOpen = async ({ status, transactionId, updatedAt }) => {
    const doc = await RefundRequest.create({
      claimId: oid(),
      transactionId: transactionId || oid(),
      customerId: oid(),
      brandId: oid(),
      claimCode: "TD-ACD349",
      requestedAmount: 810,
      reason: REFUND_REASON.NOT_HONOURED,
    });
    doc.status = status;
    await doc.save();
    if (updatedAt) {
      await RefundRequest.collection.updateOne(
        { _id: doc._id },
        { $set: { updatedAt } },
      );
    }
    return doc;
  };

  /**
   * ⚠️ `escalateStaleRefunds` only looks at `REQUESTED`. Once a vendor says yes
   * the request leaves every sweep's filter and waits for an admin to press pay
   * — and if nobody does, it waits for ever. The customer has been told their
   * money is approved and is not getting it.
   */
  it("flags a refund approved by somebody and paid by nobody", async () => {
    await seedOpen({
      status: REFUND_REQUEST_STATUS.VENDOR_APPROVED,
      updatedAt: ago(3 * DAY),
    });

    const health = await getPaymentHealth();
    expect(health.stuck.stalledApprovals).toBe(1);
    expect(health.status).toBe(PAYMENT_HEALTH_STATUS.ATTENTION);
  });

  it("gives a fresh approval a day before calling it stalled", async () => {
    await seedOpen({ status: REFUND_REQUEST_STATUS.VENDOR_APPROVED });

    const health = await getPaymentHealth();
    expect(health.stuck.stalledApprovals).toBe(0);
  });

  /**
   * ⚠️ The one that actually moves money the wrong way: settlement pays the
   * vendor for a claim that is about to be refunded, and then the refund has
   * nothing to come out of. The whole "no recovery, no negative balance"
   * guarantee rests on that hold existing.
   */
  it("flags an open refund whose payment is not held", async () => {
    const txn = await Transaction.create(
      claimPayment({ verified: true, settlementHold: false }),
    );
    await seedOpen({
      status: REFUND_REQUEST_STATUS.REQUESTED,
      transactionId: txn._id,
    });

    const health = await getPaymentHealth();
    expect(health.stuck.unheldRefunds).toBe(1);
    // Money can still be paid to the wrong side, so this is not a "look at it
    // later" problem.
    expect(health.status).toBe(PAYMENT_HEALTH_STATUS.CRITICAL);
  });

  it("does not flag one that is properly held", async () => {
    const txn = await Transaction.create(
      claimPayment({ verified: true, settlementHold: true }),
    );
    await seedOpen({
      status: REFUND_REQUEST_STATUS.REQUESTED,
      transactionId: txn._id,
    });

    const health = await getPaymentHealth();
    expect(health.stuck.unheldRefunds).toBe(0);
  });

  it("does not flag a closed refund whose hold was released", async () => {
    const txn = await Transaction.create(
      claimPayment({ verified: true, settlementHold: false }),
    );
    await seedOpen({
      status: REFUND_REQUEST_STATUS.VENDOR_REJECTED,
      transactionId: txn._id,
    });

    const health = await getPaymentHealth();
    // Rejected means no money is moving — the hold is *supposed* to be off.
    expect(health.stuck.unheldRefunds).toBe(0);
  });
});
