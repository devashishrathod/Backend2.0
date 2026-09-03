const mongoose = require("mongoose");

/**
 * `notify` is stubbed so nothing leaves the process — but every line **above**
 * it runs: the title, the money formatting, the deep link, the mail table.
 */
const mockNotify = jest.fn(async (args) => args);
jest.mock("../../helpers/notifications/notify", () => ({
  notify: (...args) => mockNotify(...args),
  resolveRecipient: jest.fn(),
}));

const notices = require("../../helpers/notifications");
const { SETTLEMENT_STATUS } = require("../../constants/settlement");
const { REFUND_REQUEST_STATUS } = require("../../constants/refund");

const oid = () => new mongoose.Types.ObjectId();

/**
 * Every money notice, actually built.
 *
 * ### Why this exists
 *
 * Twice in one day a notice referenced an identifier that was never imported.
 * Both times the module **loaded fine** — a free identifier inside a function
 * body is only a `ReferenceError` when that function runs — so `node --check`
 * passed, `require()` passed, and the fault would have surfaced the first time a
 * real vendor was due a real message.
 *
 * The same shape as the `settlement.processed` bug that left the entire payout
 * pipeline dead: code that parses, loads, and throws only when it matters.
 *
 * So this calls every one of them with a plausible payload. It asserts almost
 * nothing about the wording — the point is that they **run**, and that the
 * figures a person reads are not `undefined`.
 */

const settlement = (overrides = {}) => ({
  _id: oid(),
  brandId: oid(),
  settlementNumber: "TD/STL/26-27/000123",
  periodStart: new Date("2026-08-01T00:00:00Z"),
  periodEnd: new Date("2026-08-31T18:29:59Z"),
  netPayable: 4523.75,
  status: SETTLEMENT_STATUS.PENDING_APPROVAL,
  attemptCount: 0,
  bankSnapshot: { accountLast4Digits: "7890", bankName: "HDFC Bank" },
  createdAt: new Date("2026-09-01T00:00:00Z"),
  ...overrides,
});

const request = (overrides = {}) => ({
  _id: oid(),
  brandId: oid(),
  claimId: oid(),
  claimCode: "TD-ABC123",
  requestedAmount: 810,
  approvedAmount: 810,
  status: REFUND_REQUEST_STATUS.REQUESTED,
  vendorRespondBy: new Date("2026-09-02T00:00:00Z"),
  ...overrides,
});

const leg = { _id: oid(), legNumber: 2, amount: 2000, initiatedAt: new Date() };

/** Nothing a person reads may render as `undefined` or `NaN`. */
const assertReadable = (payload, label) => {
  const text = [
    payload?.title,
    payload?.body,
    ...(payload?.mail?.lines || []).flat(),
  ]
    .filter((v) => typeof v === "string")
    .join(" | ");

  expect({ label, undefinedIn: /undefined/.test(text) }).toEqual({
    label,
    undefinedIn: false,
  });
  expect({ label, nanIn: /NaN/.test(text) }).toEqual({ label, nanIn: false });
};

beforeEach(() => mockNotify.mockClear());

describe("every settlement notice builds and reads properly", () => {
  const cases = [
    ["paid", () => notices.notifyVendorSettlementPaid({ settlement: settlement({ status: SETTLEMENT_STATUS.PAID }), utr: "N123456789" })],
    ["failed", () => notices.notifyVendorSettlementFailed({ settlement: settlement({ status: SETTLEMENT_STATUS.FAILED }), reason: "BANK_REJECTED" })],
    ["on hold", () => notices.notifyVendorSettlementOnHold({ settlement: settlement({ status: SETTLEMENT_STATUS.ON_HOLD }) })],
    /**
     * ⚠️ This one was broken. It branches on `settlement.status` to warn that an
     * `APPROVED` settlement's NEFT may never have been keyed in — and
     * `SETTLEMENT_STATUS` was not imported in that file.
     */
    ["stuck (PROCESSING)", () => notices.notifyAdminSettlementStuck({ settlement: settlement({ status: SETTLEMENT_STATUS.PROCESSING }), leg, hours: 9 })],
    ["stuck (APPROVED — the orphan leg)", () => notices.notifyAdminSettlementStuck({ settlement: settlement({ status: SETTLEMENT_STATUS.APPROVED }), leg, hours: 9 })],
    ["late", () => notices.notifyAdminSettlementLate({ settlement: settlement(), hours: 120 })],
    ["ledger drift", () => notices.notifyAdminSettlementLedgerDrift({ settlement: settlement(), legTotal: 4523.75, ledgerTotal: 4000 })],
  ];

  it.each(cases)("builds the %s notice", async (label, build) => {
    await build();

    expect(mockNotify).toHaveBeenCalledTimes(1);
    assertReadable(mockNotify.mock.calls[0][0], label);
  });

  /** The orphan-leg warning is the whole reason that branch exists. */
  it("warns that an APPROVED settlement's transfer may never have been made", async () => {
    await notices.notifyAdminSettlementStuck({
      settlement: settlement({ status: SETTLEMENT_STATUS.APPROVED }),
      leg,
      hours: 9,
    });

    expect(mockNotify.mock.calls[0][0].body).toMatch(/may never have been made/i);
  });

  it("does not warn when the settlement really is PROCESSING", async () => {
    await notices.notifyAdminSettlementStuck({
      settlement: settlement({ status: SETTLEMENT_STATUS.PROCESSING }),
      leg,
      hours: 9,
    });

    expect(mockNotify.mock.calls[0][0].body).not.toMatch(/may never have been made/i);
  });
});

describe("every refund notice builds and reads properly", () => {
  const cases = [
    ["vendor requested", () => notices.notifyVendorRefundRequested({ request: request(), claim: { claimCode: "TD-ABC123", outletSnapshot: { storeId: "Andheri" } } })],
    ["vendor reminder", () => notices.notifyVendorRefundReminder({ request: request() })],
    ["customer approved", () => notices.notifyCustomerRefundApproved({ request: request({ status: REFUND_REQUEST_STATUS.VENDOR_APPROVED }) })],
    ["customer rejected", () => notices.notifyCustomerRefundRejected({ request: request({ status: REFUND_REQUEST_STATUS.VENDOR_REJECTED }) })],
    ["admin escalated", () => notices.notifyAdminRefundEscalated({ request: request({ status: REFUND_REQUEST_STATUS.VENDOR_TIMEOUT }) })],
    ["admin failed", () => notices.notifyAdminRefundFailed({ request: request({ status: REFUND_REQUEST_STATUS.FAILED }), reason: "instrument does not accept refunds" })],
  ];

  it.each(cases)("builds the %s notice", async (label, build) => {
    await build();

    expect(mockNotify).toHaveBeenCalledTimes(1);
    assertReadable(mockNotify.mock.calls[0][0], label);
  });

  /**
   * ⚠️ `currencySymbol`, not `symbol` — reading the wrong key printed
   * `undefined810.00` on every amount in every refund notice, in the push, the
   * mail and the SMS alike, without throwing.
   */
  it("renders money with a currency symbol", async () => {
    await notices.notifyCustomerRefundApproved({ request: request() });

    expect(mockNotify.mock.calls[0][0].body).toMatch(/₹/);
  });
});
