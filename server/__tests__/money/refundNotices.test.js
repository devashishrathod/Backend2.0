const mongoose = require("mongoose");

/**
 * `notify` is mocked so nothing is actually sent, and so each notice can be
 * inspected as the object it hands over.
 *
 * ⚠️ The factory may not close over anything out of scope unless it is named
 * `mock*` — jest hoists it above the imports.
 */
const mockNotify = jest.fn(async () => ({ sent: true }));
jest.mock("../../helpers/notifications/notify", () => ({
  notify: (...args) => mockNotify(...args),
}));

const {
  notifyVendorRefundRequested,
  notifyVendorRefundReminder,
  notifyCustomerRefundRequested,
  notifyCustomerRefundApproved,
  notifyCustomerRefundRejected,
  notifyAdminRefundEscalated,
  notifyAdminRefundFailed,
  sendQuietly,
} = require("../../helpers/notifications");
const { ADMIN_PATHS } = require("../../helpers/notifications/panelLinks");
const {
  NOTIFICATION_AUDIENCE,
  NOTIFICATION_SEVERITY,
  NOTIFICATION_TYPES,
} = require("../../constants/notification");
const {
  REFUND_REQUEST_STATUS,
  REFUND_REASON,
  REFUND_CUSTOMER_LABEL,
} = require("../../constants/refund");

const oid = () => new mongoose.Types.ObjectId();

const request = (overrides = {}) => ({
  _id: oid(),
  claimId: oid(),
  transactionId: oid(),
  customerId: oid(),
  brandId: oid(),
  claimCode: "TD-ACD349",
  requestedAmount: 810,
  approvedAmount: 810,
  reason: REFUND_REASON.NOT_HONOURED,
  reasonNote: "The outlet was shut when I got there.",
  // The staff notes that must never reach the customer.
  vendorNote: "Customer collected the order in full.",
  adminNote: "Overrode the outlet; photos support the customer.",
  status: REFUND_REQUEST_STATUS.REQUESTED,
  vendorRespondBy: new Date("2026-09-02T10:00:00Z"),
  attemptCount: 1,
  ...overrides,
});

const lastCall = () => mockNotify.mock.calls[mockNotify.mock.calls.length - 1][0];
const asText = () => JSON.stringify(lastCall());

beforeEach(() => mockNotify.mockClear());

describe("who each notice goes to", () => {
  it("asks the vendor, and warns rather than informs", async () => {
    await notifyVendorRefundRequested({ request: request(), claim: null });
    const call = lastCall();

    expect(call.audience).toBe(NOTIFICATION_AUDIENCE.VENDOR);
    // There is a deadline, and missing it takes the decision away from them.
    expect(call.severity).toBe(NOTIFICATION_SEVERITY.WARNING);
    expect(call.brandId).toBeTruthy();
    expect(call.customerId).toBeUndefined();
  });

  it("tells the customer their request is in", async () => {
    await notifyCustomerRefundRequested({ request: request() });
    const call = lastCall();

    expect(call.audience).toBe(NOTIFICATION_AUDIENCE.CUSTOMER);
    expect(call.customerId).toBeTruthy();
    expect(call.brandId).toBeUndefined();
  });

  /**
   * Nobody else can move an escalated refund, and the customer has already
   * waited a full window.
   */
  it("escalates to an admin as a warning", async () => {
    await notifyAdminRefundEscalated({ request: request() });
    const call = lastCall();

    expect(call.audience).toBe(NOTIFICATION_AUDIENCE.ADMIN);
    expect(call.severity).toBe(NOTIFICATION_SEVERITY.WARNING);
  });

  /**
   * ⚠️ CRITICAL. A failed refund is a customer who has been told their money is
   * coming and is not getting it, and nothing else in the system will fix it.
   */
  it("treats a failed refund as critical", async () => {
    await notifyAdminRefundFailed({
      request: request(),
      reason: "Instrument cannot accept a refund",
    });
    const call = lastCall();

    expect(call.audience).toBe(NOTIFICATION_AUDIENCE.ADMIN);
    expect(call.severity).toBe(NOTIFICATION_SEVERITY.CRITICAL);
    expect(call.body).toMatch(/instrument cannot accept/i);
  });
});

describe("what the customer is never told", () => {
  /**
   * ⚠️ *"Customer collected the order in full"* is written for staff. Rendered
   * to the customer it is about, it is an accusation.
   */
  it("never repeats the vendor's note back to them", async () => {
    for (const send of [
      notifyCustomerRefundRequested,
      notifyCustomerRefundApproved,
      notifyCustomerRefundRejected,
    ]) {
      mockNotify.mockClear();
      await send({ request: request() });
      expect(asText()).not.toContain("collected the order");
      expect(asText()).not.toContain("Overrode the outlet");
    }
  });

  /**
   * Telling a customer the outlet ignored them starts a fight the platform then
   * has to referee, and it is not something they can act on.
   */
  it("never says the outlet went silent", async () => {
    await notifyCustomerRefundRequested({
      request: request({ status: REFUND_REQUEST_STATUS.VENDOR_TIMEOUT }),
    });

    expect(asText()).not.toMatch(/timeout|ignored|did not respond|no response/i);
    expect(lastCall().meta.statusLabel).toBe(
      REFUND_CUSTOMER_LABEL[REFUND_REQUEST_STATUS.VENDOR_TIMEOUT],
    );
  });

  /**
   * A decline has to leave a way through. "Declined" with no next step produces
   * the support ticket anyway, only angrier.
   */
  it("points a declined customer at a person", async () => {
    await notifyCustomerRefundRejected({ request: request() });

    expect(lastCall().body).toMatch(/write to us/i);
    expect(lastCall().deepLink).toMatch(/support/i);
  });
});

describe("a part-approval is said out loud", () => {
  /**
   * A customer who asked for ₹810 and quietly receives ₹400 opens a second
   * request and a support ticket.
   */
  it("names both figures when less was approved", async () => {
    await notifyCustomerRefundApproved({
      request: request({ approvedAmount: 400 }),
    });
    const call = lastCall();

    expect(call.body).toMatch(/400\.00/);
    expect(call.body).toMatch(/810\.00/);
    expect(call.meta.isPartialApproval).toBe(true);
  });

  it("does not labour the point when the whole amount was approved", async () => {
    await notifyCustomerRefundApproved({ request: request() });
    const call = lastCall();

    expect(call.meta.isPartialApproval).toBe(false);
    expect(call.body).not.toMatch(/of the/i);
  });
});

describe("nothing is sent twice", () => {
  it("keys every notice on the request", async () => {
    const req = request();

    for (const send of [
      notifyVendorRefundRequested,
      notifyCustomerRefundRequested,
      notifyCustomerRefundApproved,
      notifyCustomerRefundRejected,
      notifyAdminRefundEscalated,
    ]) {
      mockNotify.mockClear();
      await send({ request: req, claim: null });
      expect(lastCall().dedupeKey).toContain(String(req._id));
    }
  });

  /**
   * ⚠️ Two nudges are **meant** to arrive. A key on the request alone would
   * silence the second one — the reminder that actually lands before a deadline.
   */
  it("keys a reminder on the nudge number, so the second still sends", async () => {
    const req = request({ remindersSent: 0 });
    await notifyVendorRefundReminder({ request: req });
    const first = lastCall().dedupeKey;

    await notifyVendorRefundReminder({ request: { ...req, remindersSent: 1 } });
    const second = lastCall().dedupeKey;

    expect(first).not.toBe(second);
  });

  /**
   * Each failed retry is news. A key without the attempt would silence every
   * failure after the first — including the one that says the instrument cannot
   * take the money back at all.
   */
  it("keys a failure on the attempt, so a second failure still sends", async () => {
    const req = request({ attemptCount: 1 });
    await notifyAdminRefundFailed({ request: req, reason: "x" });
    const first = lastCall().dedupeKey;

    await notifyAdminRefundFailed({
      request: { ...req, attemptCount: 2 },
      reason: "x",
    });
    expect(lastCall().dedupeKey).not.toBe(first);
  });
});

describe("the links go somewhere", () => {
  /**
   * ⚠️ A missing path key does not throw — it produces `undefined`, which
   * `deepLink` turns into a bare `/`. The notification still sends and still
   * looks fine; it just goes nowhere, and nobody finds out until somebody taps
   * one. `ADMIN_PATHS.DASHBOARD` did not exist and was being used.
   */
  it("gives an admin notice a real destination", async () => {
    const req = request();
    await notifyAdminRefundEscalated({ request: req });

    const link = lastCall().deepLink;
    expect(link).toContain(String(req._id));
    expect(link).not.toBe("/");
    expect(link).not.toMatch(/undefined/);
  });

  it("has the admin refund paths it uses", () => {
    expect(ADMIN_PATHS.REFUNDS).toBeTruthy();
    expect(typeof ADMIN_PATHS.refund).toBe("function");
    expect(ADMIN_PATHS.refund("abc")).toContain("abc");
  });

  it("sends a customer to the transaction they are asking about", async () => {
    const req = request();
    await notifyCustomerRefundRequested({ request: req });

    expect(lastCall().deepLink).toContain(String(req.transactionId));
  });
});

describe("a lost notice never undoes the money", () => {
  /**
   * ⚠️ A refund that went out, a hold that came off, a decision that was
   * recorded — none may be rolled back because a mail server was down. The money
   * has already moved; throwing would unwind a settled operation over a delivery
   * failure.
   */
  it("swallows a failure and reports it", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});

    const result = await sendQuietly(async () => {
      throw new Error("smtp on fire");
    }, "test notice");

    expect(result).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("hands back what the notice returned when it works", async () => {
    const result = await sendQuietly(async () => ({ sent: true }), "test notice");
    expect(result).toEqual({ sent: true });
  });
});

describe("every refund state that matters has a type", () => {
  /**
   * There is deliberately no notice for `PROCESSING` or `ADMIN_APPROVED`: real
   * transitions with nothing for anyone to do about them. A notification nobody
   * can act on trains people to ignore the ones that matter.
   */
  it("has a type for each notice that exists", () => {
    for (const type of [
      "REFUND_REQUESTED",
      "REFUND_APPROVED",
      "REFUND_REJECTED",
      "REFUND_FAILED",
      "REFUND_ESCALATED",
      "REFUND_REMINDER",
    ]) {
      expect(NOTIFICATION_TYPES[type]).toBe(type);
    }
  });
});
