const crypto = require("crypto");
const mongoose = require("mongoose");

/**
 * `settlements.reports` is the only outbound call this path makes. Mocked at the
 * config boundary so the branch itself runs for real.
 *
 * ### ⚠️ It used to be `payments.all({ settlement_id })`, and that was a bug
 *
 * That call **silently ignores the filter**. Measured against a live account:
 * `payments.all({ settlement_id: "setl_X" })` and `payments.all()` both returned
 * the same 42 payments — the whole account rather than the batch.
 *
 * So one `settlement.processed` would have stamped `fundsReceivedAt` on every
 * captured claim payment, including ones the gateway was still holding, and
 * `buildEligibilityFilter` would then have released all of them into a payout
 * run. Vendors paid out of money that had not arrived.
 *
 * These tests could not catch it, because the mock answered the way the real API
 * was *assumed* to: the fixture returned only the ids the test had chosen, so
 * "leaves payments that are not in the batch alone" passed against code that in
 * production would have marked everything. A mock that encodes the assumption
 * rather than the behaviour proves the assumption, not the code.
 *
 * The fixtures below therefore return a **whole day's recon report** — other
 * settlements' rows included — so filtering by `settlement_id` is something the
 * code has to actually do.
 */
const mockReports = jest.fn();
jest.mock("../../configs/razorpay", () => ({
  /**
   * ⚠️ Spread the real module, override one function.
   *
   * Replacing the whole thing broke signature verification with
   * `getRazorpayWebhookSecrets is not a function` — `verifyRazorpayWebhook`
   * imports that from here too. A mock narrower than the module's real surface
   * fails somewhere unrelated to what it was meant to stub.
   */
  ...jest.requireActual("../../configs/razorpay"),
  getRazorpayAccount: () => ({
    keyId: "rzp_test_x",
    instance: { settlements: { reports: (...a) => mockReports(...a) } },
  }),
}));

const {
  connectTestDb,
  disconnectTestDb,
  clearCollections,
} = require("./setup/testDb");

const Transaction = require("../../models/Transaction");
const WebhookEvent = require("../../models/WebhookEvent");
const {
  processWebhookEvent,
  handleRazorpayWebhook,
} = require("../../services/transactions/handleRazorpayWebhook");
const {
  RAZORPAY_WEBHOOK_EVENTS,
  WEBHOOK_STATUS,
} = require("../../constants/webhook");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");
const { PAYMENT_STATUS } = require("../../constants");
const { istDateKey } = require("../../helpers/dates");

const oid = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms);

/**
 * `settlement.processed` — the event every vendor payout waits on.
 *
 * ### Why this file exists
 *
 * It did not, and the branch was dead for the whole of phase S2. A missing `};`
 * left `processWebhookEvent` spanning 585 lines and swallowing
 * `handleGatewaySettlement`, which is *called* at the top of that function and
 * was *declared* 160 lines below the call — so every delivery threw
 * `ReferenceError: Cannot access 'handleGatewaySettlement' before
 * initialization` from the temporal dead zone.
 *
 * Nothing surfaced it. The caller catches, records a FAILED webhook and answers
 * Razorpay 200, so it never retried. `recordFundsReceived` never ran,
 * `fundsReceivedAt` stayed null on every payment, and eligibility requires it —
 * **no settlement was ever built and no vendor was ever paid.**
 *
 * The one test that mentioned this event asserted it was present in an enum. It
 * never delivered it. So the rule here: this suite drives the real handler and
 * asserts on the **database**, because the enum was right the whole time.
 */

const payment = (overrides = {}) =>
  Transaction.create({
    purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
    gatewayAccount: RAZORPAY_ACCOUNTS.CUSTOMER,
    customerId: oid(),
    brandId: oid(),
    amount: 810,
    paidAmount: 810,
    status: PAYMENT_STATUS.CAPTURED,
    verified: true,
    verifiedAt: ago(2 * DAY),
    fundsReceivedAt: null,
    invoiceId: `TD/VCH/26-27/${Math.floor(Math.random() * 1e6)}`,
    voucher: { netBill: 800, vendorPayable: 800 },
    ...overrides,
  });

const SETTLED_AT = Math.floor(ago(DAY).getTime() / 1000);

const deliver = (entity, extra = {}) =>
  processWebhookEvent({
    record: { _id: new mongoose.Types.ObjectId(), transactionId: null },
    event: RAZORPAY_WEBHOOK_EVENTS.SETTLEMENT_PROCESSED,
    // `extract()` never pulls the settlement entity — a settlement event is
    // about a batch, not one payment — which is why the branch needs `body`.
    ids: {},
    account: RAZORPAY_ACCOUNTS.CUSTOMER,
    body: {
      event: RAZORPAY_WEBHOOK_EVENTS.SETTLEMENT_PROCESSED,
      payload: entity === null ? {} : { settlement: { entity } },
    },
    ...extra,
  });

/**
 * A settlement recon row, in the shape the gateway really returns.
 *
 * Captured from a live response, so the field names here are the ones the code
 * has to read rather than the ones it would be convenient to invent:
 * `entity_id` holds the payment, `type` separates payments from refunds and
 * adjustments, and `settled` marks rows whose money has actually moved.
 */
const row = (paymentId, settlementId = "setl_A1", overrides = {}) => ({
  type: "payment",
  entity_id: paymentId,
  settlement_id: settlementId,
  settled: true,
  settled_at: SETTLED_AT,
  ...overrides,
});

const page = (rows) => ({ items: rows });

/**
 * Signed exactly the way the receiver sees it, so the end-to-end case below
 * exercises the real entry point rather than a hand-assembled call.
 */
const TEST_SECRET = "money-tests-customer-webhook-secret";
const CUSTOMER_SECRETS_ENV = "RAZORPAY_CUSTOMER_WEBHOOK_SECRETS";
const savedEnv = {};

const signedDelivery = (entity) => {
  const body = {
    event: RAZORPAY_WEBHOOK_EVENTS.SETTLEMENT_PROCESSED,
    created_at: SETTLED_AT,
    payload: { settlement: { entity } },
  };
  const rawBody = Buffer.from(JSON.stringify(body));
  return {
    body,
    rawBody,
    signature: crypto
      .createHmac("sha256", TEST_SECRET)
      .update(rawBody)
      .digest("hex"),
  };
};

beforeAll(async () => {
  savedEnv[CUSTOMER_SECRETS_ENV] = process.env[CUSTOMER_SECRETS_ENV];
  process.env[CUSTOMER_SECRETS_ENV] = TEST_SECRET;

  await connectTestDb();
  await Transaction.createIndexes();
});

afterAll(async () => {
  if (savedEnv[CUSTOMER_SECRETS_ENV] === undefined) {
    delete process.env[CUSTOMER_SECRETS_ENV];
  } else {
    process.env[CUSTOMER_SECRETS_ENV] = savedEnv[CUSTOMER_SECRETS_ENV];
  }
  await clearCollections(Transaction, WebhookEvent);
  await disconnectTestDb();
});

beforeEach(async () => {
  await clearCollections(Transaction, WebhookEvent);
  mockReports.mockReset();
});

describe("the event can be handled at all", () => {
  /**
   * The regression. Before the fix this threw a ReferenceError every single
   * time, from the first line of the branch.
   */
  it("does not throw", async () => {
    mockReports.mockResolvedValue(page([]));

    await expect(
      deliver({ id: "setl_A1", created_at: SETTLED_AT }),
    ).resolves.toBeDefined();
  });

  /**
   * The report is pulled for the settlement's own **IST** day.
   *
   * ⚠️ Verified against a live batch: `settled_at` 1788767017 appears in the
   * report for 2026-09-07, its IST date. A UTC day would agree for most of the
   * clock and be silently wrong for anything settled after 18:30 UTC — which is
   * a whole batch of payments quietly never marked, on a rule that looks right
   * in every test written before 18:30.
   */
  it("asks for the report of the settlement's IST day", async () => {
    mockReports.mockResolvedValue(page([]));

    await deliver({ id: "setl_A1", created_at: SETTLED_AT });

    const [year, month, day] = istDateKey(new Date(SETTLED_AT * 1000))
      .split("-")
      .map(Number);

    expect(mockReports).toHaveBeenCalledWith(
      expect.objectContaining({ year, month, day }),
    );
  });
});

describe("marking the money as ours", () => {
  it("fills fundsReceivedAt on the payments in the batch", async () => {
    const mine = await payment({ razorpayPaymentId: "pay_1" });
    mockReports.mockResolvedValue(page([row("pay_1")]));

    await deliver({ id: "setl_A1", created_at: SETTLED_AT });

    const after = await Transaction.findById(mine._id).lean();
    expect(after.fundsReceivedAt).not.toBeNull();
    expect(after.razorpaySettlementId).toBe("setl_A1");
  });

  /**
   * ⚠️ The whole point. Eligibility requires `fundsReceivedAt: {$ne: null}`, so
   * a payment this never touches can never be settled, and the vendor is never
   * paid — silently, because nothing errors.
   */
  it("is what makes a payment eligible for settlement at all", async () => {
    const {
      buildEligibilityFilter,
    } = require("../../helpers/settlements");
    const mine = await payment({ razorpayPaymentId: "pay_1" });

    const eligible = () =>
      Transaction.countDocuments({
        ...buildEligibilityFilter({
          brandId: mine.brandId,
          eligibleBefore: new Date(),
          fundsReceivedBefore: new Date(),
        }),
      });

    expect(await eligible()).toBe(0);

    mockReports.mockResolvedValue(page([row("pay_1")]));
    await deliver({ id: "setl_A1", created_at: SETTLED_AT });

    expect(await eligible()).toBe(1);
  });

  /**
   * The gateway's own timestamp, not ours. A webhook that arrives two days late
   * must not make the money look two days newer than it is — T+N is counted
   * from this field.
   */
  it("dates the money from the gateway, not from when we processed it", async () => {
    const mine = await payment({ razorpayPaymentId: "pay_1" });
    mockReports.mockResolvedValue(page([row("pay_1")]));

    await deliver({ id: "setl_A1", created_at: SETTLED_AT });

    const after = await Transaction.findById(mine._id).lean();
    expect(Math.abs(after.fundsReceivedAt.getTime() - SETTLED_AT * 1000)).toBeLessThan(
      2000,
    );
  });

  /**
   * ⚠️ **The one that matters most, and the one the old fixture could not test.**
   *
   * A day's recon report contains every settlement that day, not just ours. The
   * previous version of this test handed the code a list containing only
   * `pay_1`, so it passed no matter what the code did with it — while the real
   * `payments.all({ settlement_id })` was returning the entire account and
   * would have marked both.
   *
   * Now the fixture returns what the gateway returns: three rows across two
   * settlements. Only `setl_A1`'s payment may be touched. Marking `pay_2` means
   * a vendor is paid out of a batch the gateway has not sent us, which is the
   * exact thing `fundsReceivedAt` exists to prevent.
   */
  it("marks only this settlement's payments, not the rest of the day's report", async () => {
    const mine = await payment({ razorpayPaymentId: "pay_1" });
    const otherBatch = await payment({ razorpayPaymentId: "pay_2" });
    const notSettled = await payment({ razorpayPaymentId: "pay_3" });

    mockReports.mockResolvedValue(
      page([
        row("pay_1", "setl_A1"),
        // A different settlement on the same day — the gateway returns these too.
        row("pay_2", "setl_B2"),
        // Ours, but the money has not actually moved yet.
        row("pay_3", "setl_A1", { settled: false }),
      ]),
    );

    await deliver({ id: "setl_A1", created_at: SETTLED_AT });

    expect((await Transaction.findById(mine._id).lean()).fundsReceivedAt).not.toBeNull();
    expect((await Transaction.findById(otherBatch._id).lean()).fundsReceivedAt).toBeNull();
    expect((await Transaction.findById(notSettled._id).lean()).fundsReceivedAt).toBeNull();
  });

  /**
   * A report row can be a refund or an adjustment rather than a payment, and
   * `entity_id` then names something that is not a payment at all. Passing one
   * to `recordFundsReceived` would match nothing — harmless today — but the
   * filter is what keeps that true.
   */
  it("ignores report rows that are not payments", async () => {
    const mine = await payment({ razorpayPaymentId: "pay_1" });

    mockReports.mockResolvedValue(
      page([
        row("pay_1", "setl_A1", { type: "refund" }),
        row("pay_1", "setl_A1", { type: "adjustment" }),
      ]),
    );

    await deliver({ id: "setl_A1", created_at: SETTLED_AT });

    expect((await Transaction.findById(mine._id).lean()).fundsReceivedAt).toBeNull();
  });

  /** Razorpay redelivers. The timestamp must not walk forward on a repeat. */
  it("is idempotent under redelivery", async () => {
    const mine = await payment({ razorpayPaymentId: "pay_1" });
    mockReports.mockResolvedValue(page([row("pay_1")]));

    await deliver({ id: "setl_A1", created_at: SETTLED_AT });
    const first = (await Transaction.findById(mine._id).lean()).fundsReceivedAt;

    await deliver({ id: "setl_A1", created_at: SETTLED_AT });
    const second = (await Transaction.findById(mine._id).lean()).fundsReceivedAt;

    expect(second.getTime()).toBe(first.getTime());
  });

  /** A busy day settles more than one page of 100. */
  it("pages until the report runs out", async () => {
    const filler = Array.from({ length: 100 }, (_, i) => row(`pay_${i}`));
    await payment({ razorpayPaymentId: "pay_0" });
    const last = await payment({ razorpayPaymentId: "pay_tail" });

    mockReports
      .mockResolvedValueOnce(page(filler))
      .mockResolvedValueOnce(page([row("pay_tail")]));

    await deliver({ id: "setl_A1", created_at: SETTLED_AT });

    expect(mockReports).toHaveBeenCalledTimes(2);
    expect(
      (await Transaction.findById(last._id).lean()).fundsReceivedAt,
    ).not.toBeNull();
  });
});

describe("when it cannot be handled", () => {
  it("ignores an event carrying no settlement entity", async () => {
    const result = await deliver(null);

    expect(result.status).toBe(WEBHOOK_STATUS.IGNORED);
    expect(mockReports).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ FAILED, never IGNORED. Without the payment list nothing becomes
   * eligible, and an ignored event would mean a vendor's payout never arrives
   * with nothing anywhere saying why — the failure this whole file is about.
   */
  it("records a FAILED webhook when the report cannot be fetched", async () => {
    await payment({ razorpayPaymentId: "pay_1" });
    mockReports.mockRejectedValue(new Error("gateway down"));

    const result = await deliver({ id: "setl_A1", created_at: SETTLED_AT });

    expect(result.status).toBe(WEBHOOK_STATUS.FAILED);
    expect(result.outcome).toMatch(/setl_A1/);
  });

  /**
   * ⚠️ "The gateway would not answer" and "the batch carried nothing of ours"
   * must not look the same.
   *
   * An empty report is a real, ordinary answer: a settlement can carry only
   * refunds, or only another merchant's payments. Recording that as FAILED would
   * put a healthy delivery on the replay worklist for ever. Recording an outage
   * as PROCESSED is the worse half — the settlement is written off as carrying
   * nothing and **nothing ever comes back for it**, which is the precise shape
   * of silent loss this file exists to undo.
   */
  it("records an empty report as processed, not as a failure", async () => {
    await payment({ razorpayPaymentId: "pay_1" });
    mockReports.mockResolvedValue(page([]));

    const result = await deliver({ id: "setl_A1", created_at: SETTLED_AT });

    expect(result.status).toBe(WEBHOOK_STATUS.PROCESSED);
  });
});

/**
 * ⚠️ Through the real entry point, not `processWebhookEvent` directly.
 *
 * Every test above hands `body` in itself, so none of them can notice if
 * `handleRazorpayWebhook` stops passing it along — which was the *second* half
 * of the original bug: even with the temporal-dead-zone fault repaired, the call
 * site referenced a `body` that was never a parameter. A mutation run proved the
 * gap: deleting `body` from the real call site left all of them green.
 *
 * So this one starts where Razorpay does: a signed payload on the wire.
 */
describe("end to end, from the signed delivery", () => {
  it("carries the body all the way to the settlement branch", async () => {
    const mine = await payment({ razorpayPaymentId: "pay_e2e" });
    mockReports.mockResolvedValue(page([row("pay_e2e", "setl_E2E")]));

    const { body, rawBody, signature } = signedDelivery({
      id: "setl_E2E",
      created_at: SETTLED_AT,
    });

    const result = await handleRazorpayWebhook({
      rawBody,
      signature,
      body,
      account: RAZORPAY_ACCOUNTS.CUSTOMER,
      sourceIp: "127.0.0.1",
    });

    expect(result.status).toBe(WEBHOOK_STATUS.PROCESSED);
    // The database, not the return value: the enum was right the whole time.
    const after = await Transaction.findById(mine._id).lean();
    expect(after.fundsReceivedAt).not.toBeNull();
    expect(after.razorpaySettlementId).toBe("setl_E2E");
  });

  /**
   * The exact shape of the original failure: the branch threw, the caller
   * caught it, recorded a FAILED webhook and still answered Razorpay 200 — so
   * it never retried and nothing ever surfaced it.
   */
  it("does not quietly record a FAILED webhook", async () => {
    await payment({ razorpayPaymentId: "pay_e2e2" });
    mockReports.mockResolvedValue(page([row("pay_e2e2", "setl_E2E2")]));

    const { body, rawBody, signature } = signedDelivery({
      id: "setl_E2E2",
      created_at: SETTLED_AT,
    });

    await handleRazorpayWebhook({
      rawBody,
      signature,
      body,
      account: RAZORPAY_ACCOUNTS.CUSTOMER,
      sourceIp: "127.0.0.1",
    });

    const failed = await WebhookEvent.countDocuments({
      status: WEBHOOK_STATUS.FAILED,
    });
    expect(failed).toBe(0);
  });
});
