const crypto = require("crypto");
const mongoose = require("mongoose");
const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const WebhookEvent = require("../../models/WebhookEvent");
const Transaction = require("../../models/Transaction");
const {
  handleRazorpayWebhook,
} = require("../../services/transactions/handleRazorpayWebhook");
const {
  WEBHOOK_STATUS,
  WEBHOOK_NEVER_REPLAYABLE_STATUSES,
} = require("../../constants/webhook");
const {
  RAZORPAY_ACCOUNTS,
  TRANSACTION_PURPOSE,
} = require("../../constants/transaction");

const oid = () => new mongoose.Types.ObjectId();

/**
 * The webhook secret these tests sign with.
 *
 * Set on `process.env` here rather than read from `.env`: a test that depends on
 * whichever secret happens to be configured passes or fails for reasons that
 * have nothing to do with the code, and would leak a real secret into a failure
 * message.
 */
const TEST_SECRET = "money-tests-vendor-webhook-secret";
// The exact names `configs/razorpay.js` reads for the VENDOR account.
const VENDOR_SECRETS_ENV = "RAZORPAY_WEBHOOK_SECRETS";
const LEGACY_SECRET_ENV = "RAZORPAY_WEBHOOK_SECRET";
const CUSTOMER_SECRETS_ENV = "RAZORPAY_CUSTOMER_WEBHOOK_SECRETS";
const saved = {};

/**
 * The rejection these tests mean.
 *
 * Asserting only on `statusCode: 400` is not enough: "no webhook secret is
 * configured" is also a 400, and an earlier draft of this suite passed entirely
 * because of it — proving nothing about signature verification. Every rejection
 * assertion names the reason.
 */
const BAD_SIGNATURE = /signature verification failed.*(mismatch|did not match|invalid)/i;

const sign = (rawBody, secret = TEST_SECRET) =>
  crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

/** A Razorpay `payment.captured` delivery, as the receiver actually sees it. */
const delivery = (event, payment = {}) => {
  const body = {
    event,
    created_at: 1756500000,
    payload: {
      payment: {
        entity: {
          id: payment.id || `pay_TEST${Date.now()}`,
          order_id: payment.order_id || `order_TEST${Date.now()}`,
          amount: payment.amount ?? 10000,
          currency: "INR",
          status: payment.status || "captured",
          method: payment.method || "upi",
          ...payment,
        },
      },
    },
  };
  // Signed over the exact bytes, the way express hands them to the receiver.
  const rawBody = Buffer.from(JSON.stringify(body));
  return { body, rawBody, signature: sign(rawBody) };
};

beforeAll(async () => {
  for (const key of [VENDOR_SECRETS_ENV, LEGACY_SECRET_ENV, CUSTOMER_SECRETS_ENV]) {
    saved[key] = process.env[key];
  }
  process.env[VENDOR_SECRETS_ENV] = TEST_SECRET;
  // Cleared so a real secret from `.env` cannot verify a delivery this suite
  // signed with the test secret, and so the CUSTOMER account is genuinely
  // unconfigured for the misroute checks.
  delete process.env[LEGACY_SECRET_ENV];
  delete process.env[CUSTOMER_SECRETS_ENV];

  await connectTestDb();
});

afterAll(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await clearCollections(WebhookEvent, Transaction);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(WebhookEvent, Transaction);
});

describe("a rejected delivery does not poison the retry", () => {
  /**
   * Test 3 — §3.4.
   *
   * The bug this guards against was introduced by the fix for a different one.
   *
   * Recording a rejected delivery is necessary: without it, a wrong or
   * not-yet-deployed webhook secret produces captured payments with no trace
   * anywhere. But the obvious implementation stores it under the `x-razorpay-
   * event-id` header — which is **attacker-controlled on a delivery that failed
   * verification**. Razorpay then retries with the same event id and a correct
   * signature, and the genuine retry collides with the row written by the
   * forgery, is marked `DUPLICATE`, and the payment never settles.
   *
   * So the rejected row is keyed on a hash of the body under its own namespace,
   * and the retry finds nothing in its way.
   */
  it("records the rejection under a key the genuine retry cannot collide with", async () => {
    const { body, rawBody } = delivery("payment.captured");
    const forgedEventId = "evt_attacker_controlled_id";

    await expect(
      handleRazorpayWebhook({
        rawBody,
        signature: "0".repeat(64),
        eventId: forgedEventId,
        body,
        account: RAZORPAY_ACCOUNTS.VENDOR,
      }),
    ).rejects.toMatchObject({ statusCode: 400, message: BAD_SIGNATURE });

    const rejected = await WebhookEvent.findOne({
      status: WEBHOOK_STATUS.REJECTED,
    });
    expect(rejected).toBeTruthy();
    // The claimed id is kept for forensics but is NOT the dedupe key.
    expect(rejected.claimedEventId).toBe(forgedEventId);
    expect(rejected.eventId).not.toBe(forgedEventId);
    expect(rejected.eventId).toMatch(/^REJECTED:/);
  });

  it("lets the genuine retry through and settles it", async () => {
    const { body, rawBody, signature } = delivery("payment.captured");
    const eventId = "evt_same_id_on_both";

    await expect(
      handleRazorpayWebhook({
        rawBody,
        signature: "0".repeat(64),
        eventId,
        body,
        account: RAZORPAY_ACCOUNTS.VENDOR,
      }),
    ).rejects.toMatchObject({ statusCode: 400, message: BAD_SIGNATURE });

    // Same event id, correct signature. Must NOT be seen as a duplicate.
    const result = await handleRazorpayWebhook({
      rawBody,
      signature,
      eventId,
      body,
      account: RAZORPAY_ACCOUNTS.VENDOR,
    });

    expect(result.status).not.toBe(WEBHOOK_STATUS.DUPLICATE);

    const accepted = await WebhookEvent.findOne({ eventId });
    expect(accepted).toBeTruthy();
    expect(accepted.status).not.toBe(WEBHOOK_STATUS.REJECTED);
  });

  it("counts repeated forgeries on one row instead of filling the collection", async () => {
    const { body, rawBody } = delivery("payment.captured");

    for (const attempt of [1, 2, 3]) {
      await expect(
        handleRazorpayWebhook({
          rawBody,
          signature: "0".repeat(64),
          // A different claimed id each time — a real attacker would vary it.
          eventId: `evt_forged_${attempt}`,
          body,
          account: RAZORPAY_ACCOUNTS.VENDOR,
        }),
      ).rejects.toMatchObject({ statusCode: 400, message: BAD_SIGNATURE });
    }

    const rows = await WebhookEvent.find({ status: WEBHOOK_STATUS.REJECTED });
    expect(rows).toHaveLength(1);
    expect(rows[0].attempts).toBe(3);
  });

  it("stores a preview of the body, never the whole payload", async () => {
    const { body, rawBody } = delivery("payment.captured");

    await expect(
      handleRazorpayWebhook({
        rawBody,
        signature: "0".repeat(64),
        eventId: "evt_forged_preview",
        body,
        account: RAZORPAY_ACCOUNTS.VENDOR,
        sourceIp: "203.0.113.9",
      }),
    ).rejects.toMatchObject({ statusCode: 400, message: BAD_SIGNATURE });

    const row = await WebhookEvent.findOne({ status: WEBHOOK_STATUS.REJECTED });
    // An unverified body is untrusted input; keeping it whole would let anyone
    // who can reach the endpoint write arbitrary documents into this collection.
    expect(row.payload).toBeFalsy();
    expect(row.payloadSha256).toHaveLength(64);
    expect(row.payloadBytes).toBe(rawBody.length);
    expect(row.payloadPreview.length).toBeLessThanOrEqual(512);
    expect(row.sourceIp).toBe("203.0.113.9");
  });

  it("never offers a rejected delivery for replay", () => {
    // Replaying an unverified payload would process a forgery on an admin's
    // click, which is worse than the failure it is meant to recover from.
    expect(WEBHOOK_NEVER_REPLAYABLE_STATUSES).toContain(WEBHOOK_STATUS.REJECTED);
  });
});

describe("payment.authorized is not a capture", () => {
  /**
   * Test 6 — §3.5.1.
   *
   * `payment.authorized` means the bank has held the money, not that it has
   * moved. Razorpay auto-refunds an uncaptured authorization after about five
   * days, which the customer experiences as a silent failure.
   *
   * Before this had its own branch it fell through to the not-captured handler,
   * which released the promo reservation and paged admins CRITICAL — on **every
   * single payment**, milliseconds before the real capture arrived.
   */
  it("records the authorization without settling or alerting", async () => {
    const orderId = `order_AUTH${Date.now()}`;
    const transaction = await Transaction.create({
      purpose: TRANSACTION_PURPOSE.SUBSCRIPTION,
      gatewayAccount: RAZORPAY_ACCOUNTS.VENDOR,
      amount: 100,
      razorpayOrderId: orderId,
      verified: false,
    });

    const { body, rawBody, signature } = delivery("payment.authorized", {
      order_id: orderId,
      status: "authorized",
    });

    const result = await handleRazorpayWebhook({
      rawBody,
      signature,
      eventId: `evt_auth_${Date.now()}`,
      body,
      account: RAZORPAY_ACCOUNTS.VENDOR,
    });

    expect(result.received).toBe(true);

    const after = await Transaction.findById(transaction._id);
    // Stamped, so a payment stuck in this state can be found and chased.
    expect(after.authorizedAt).toBeTruthy();
    // But NOT settled — the money has not moved.
    expect(after.verified).toBe(false);
  });
});

describe("one delivery settles once", () => {
  /**
   * Test 2 — §7 case 44.
   *
   * The customer's browser calls verify at the same moment Razorpay delivers the
   * webhook. Both paths lead to the same settle function, and it claims the
   * transaction with a conditional `findOneAndUpdate` on `verified: false` — so
   * whichever arrives second finds nothing to claim and reports `alreadySettled`
   * rather than activating a second subscription.
   */
  it("dedupes a redelivery of the same event id", async () => {
    const { body, rawBody, signature } = delivery("payment.captured");
    const eventId = `evt_redelivered_${Date.now()}`;

    const first = await handleRazorpayWebhook({
      rawBody,
      signature,
      eventId,
      body,
      account: RAZORPAY_ACCOUNTS.VENDOR,
    });
    const second = await handleRazorpayWebhook({
      rawBody,
      signature,
      eventId,
      body,
      account: RAZORPAY_ACCOUNTS.VENDOR,
    });

    expect(first.status).not.toBe(WEBHOOK_STATUS.DUPLICATE);
    expect(second.status).toBe(WEBHOOK_STATUS.DUPLICATE);
    expect(await WebhookEvent.countDocuments({ eventId })).toBe(1);
  });

  it("survives two concurrent deliveries of the same event", async () => {
    const { body, rawBody, signature } = delivery("payment.captured");
    const eventId = `evt_concurrent_${Date.now()}`;

    const [a, b] = await Promise.all([
      handleRazorpayWebhook({ rawBody, signature, eventId, body, account: RAZORPAY_ACCOUNTS.VENDOR }),
      handleRazorpayWebhook({ rawBody, signature, eventId, body, account: RAZORPAY_ACCOUNTS.VENDOR }),
    ]);

    const duplicates = [a, b].filter((r) => r.status === WEBHOOK_STATUS.DUPLICATE);
    // Exactly one of the two must lose the race for the insert.
    expect(duplicates).toHaveLength(1);
    expect(await WebhookEvent.countDocuments({ eventId })).toBe(1);
  });
});

describe("a chargeback we lost must not look eligible again", () => {
  /**
   * The CUSTOMER account is deliberately left unconfigured by the suite's
   * `beforeAll`, so the misroute checks can prove an unconfigured account
   * refuses a delivery. These tests are about the **dispute branch**, not about
   * accounts, so the secret is set here and put back afterwards — leaving it set
   * would quietly weaken those other checks.
   */
  beforeAll(() => {
    process.env[CUSTOMER_SECRETS_ENV] = TEST_SECRET;
  });
  afterAll(() => {
    delete process.env[CUSTOMER_SECRETS_ENV];
  });

  /**
   * A `payment.dispute.*` delivery, which carries no payment entity at all —
   * only the dispute, with `payment_id` inside it.
   */
  const disputeDelivery = (status, txn) => {
    const body = {
      event: `payment.dispute.${status}`,
      created_at: 1756500000,
      payload: {
        dispute: {
          entity: {
            id: `disp_TEST${Date.now()}`,
            payment_id: txn.razorpayPaymentId,
            amount: 81000,
            status,
            reason_code: "chargeback",
            phase: "chargeback",
          },
        },
      },
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    return { body, rawBody, signature: sign(rawBody) };
  };

  const seedCaptured = async () =>
    Transaction.create({
      purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
      gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
      customerId: new mongoose.Types.ObjectId(),
      brandId: new mongoose.Types.ObjectId(),
      amount: 810,
      paidAmount: 810,
      verified: true,
      status: "captured",
      razorpayOrderId: `order_D${Date.now()}`,
      razorpayPaymentId: `pay_D${Date.now()}`,
      settlementHold: false,
    });

  /**
   * ⚠️ The one that was not a race — it happened every single time.
   *
   * `isDisputed` is written from `isOpen`, and `isOpen` excludes `WON`, `LOST`
   * and `CLOSED`. So `payment.dispute.lost` wrote `isDisputed: false`: the
   * chargeback we had just **lost** made the row look fully eligible, and the
   * next payout would hand the vendor money Trydood no longer has.
   */
  it("holds the money when a dispute is LOST", async () => {
    const txn = await seedCaptured();
    const { body, rawBody, signature } = disputeDelivery("lost", txn);

    await handleRazorpayWebhook({
      body,
      rawBody,
      signature,
      account: RAZORPAY_ACCOUNTS.CUSTOMER,
    });

    const after = await Transaction.findById(txn._id).lean();

    // Proved first: the delivery was actually processed. `isDisputed` defaults
    // to `false`, so asserting it alone would hold even if nothing ran at all.
    expect(after.disputeStatus).toBe("LOST");

    // `isDisputed` correctly says the dispute is no longer live…
    expect(after.isDisputed).toBe(false);
    // …and the hold is what actually keeps it out of a settlement.
    expect(after.settlementHold).toBe(true);
    expect(after.settlementHoldReason).toMatch(/chargeback/i);
  });

  it("holds it on every dispute event, open or resolved", async () => {
    for (const status of ["created", "under_review", "won", "lost", "closed"]) {
      const txn = await seedCaptured();
      const { body, rawBody, signature } = disputeDelivery(status, txn);

      await handleRazorpayWebhook({
        body,
        rawBody,
        signature,
        account: RAZORPAY_ACCOUNTS.CUSTOMER,
      });

      const after = await Transaction.findById(txn._id).lean();
      expect({ status, held: after.settlementHold }).toEqual({
        status,
        held: true,
      });
    }
  });

  /**
   * A webhook never takes the hold off. Deciding who bears the loss is a human
   * call, and `won` arriving after `lost` — Razorpay's dispute events are not
   * ordered — must not quietly release money to the vendor.
   */
  it("does not release the hold when a dispute is won", async () => {
    const txn = await seedCaptured();

    for (const status of ["lost", "won"]) {
      const { body, rawBody, signature } = disputeDelivery(status, txn);
      await handleRazorpayWebhook({
        body,
        rawBody,
        signature,
        account: RAZORPAY_ACCOUNTS.CUSTOMER,
      });
    }

    const after = await Transaction.findById(txn._id).lean();
    expect(after.settlementHold).toBe(true);
  });
});

describe("the handled list is the gate, and it must not drift", () => {
  const {
    RAZORPAY_WEBHOOK_EVENTS,
    WEBHOOK_HANDLED_EVENTS,
  } = require("../../constants/webhook");

  /**
   * ⚠️ A branch below this list is **unreachable code** until the event is named
   * in it, and nothing warns about the mismatch.
   *
   * That is exactly what happened to `refund.created` and `refund.failed`: both
   * had branches written, neither was on the list, so a failed refund fell
   * through as `IGNORED` — the customer's money never arrived, the request still
   * said `PROCESSING`, and nothing anywhere said otherwise.
   *
   * The enum is the set of events this platform knows about. If one is in it and
   * not handled, either it should be handled or it should not be in the enum.
   */
  it("handles every event the enum names", () => {
    const unhandled = Object.values(RAZORPAY_WEBHOOK_EVENTS).filter(
      (event) => !WEBHOOK_HANDLED_EVENTS.includes(event),
    );

    expect(unhandled).toEqual([]);
  });

  it("names nothing the enum does not", () => {
    const known = Object.values(RAZORPAY_WEBHOOK_EVENTS);
    const strays = WEBHOOK_HANDLED_EVENTS.filter((e) => !known.includes(e));

    // A typo here is silent in the other direction: the event never matches a
    // real delivery and the branch simply never runs.
    expect(strays).toEqual([]);
  });

  it("has a branch for each of the three that were missing", async () => {
    for (const event of [
      RAZORPAY_WEBHOOK_EVENTS.REFUND_CREATED,
      RAZORPAY_WEBHOOK_EVENTS.REFUND_FAILED,
      RAZORPAY_WEBHOOK_EVENTS.SETTLEMENT_PROCESSED,
    ]) {
      expect(WEBHOOK_HANDLED_EVENTS).toContain(event);
    }
  });
});
