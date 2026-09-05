/**
 * ⚠️ Before anything else, and before any `require`.
 *
 * The timezone bug this file guards only reproduces on a server that is **not**
 * in IST — which is production, and is not this machine. With `TZ` left alone,
 * deleting `timeZone: "Asia/Kolkata"` from the formatter would still pass here
 * and still be five and a half hours wrong on Render.
 */
process.env.TZ = "UTC";

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

/**
 * `notify` is stubbed, exactly as in `noticeSmoke.test.js`, so nothing leaves the
 * process while every line that builds the mail still runs.
 */
const mockNotify = jest.fn(async (args) => args);
jest.mock("../../helpers/notifications/notify", () => ({
  notify: (...args) => mockNotify(...args),
  resolveRecipient: jest.fn(),
}));

/**
 * ⚠️ The eight admin notices go through `notifyAdmins`, which reads the database
 * to find the admins to fan out to — and this file has no connection.
 *
 * Forwarded to the same spy: the assertion here is about the mail the notice
 * built, which is identical either way.
 */
jest.mock("../../helpers/notifications/notifyAdmins", () => ({
  notifyAdmins: (args) => mockNotify({ ...args, audience: "ADMIN" }),
}));

const {
  renderMailHtml,
  normaliseActions,
} = require("../../helpers/nodeMailer/sendMail");
const notices = require("../../helpers/notifications");
const { SETTLEMENT_STATUS } = require("../../constants/settlement");
const { REFUND_REQUEST_STATUS } = require("../../constants/refund");

/**
 * The email **as a reader receives it**.
 *
 * ### Why this file exists
 *
 * `noticeSmoke.test.js` mocks `notify` and asserts the object a notice builds.
 * That is the right test for the notice — and it is blind to everything that
 * happens after: `notify` used to forward a hand-listed set of mail fields, five
 * notice files passed `buttonText` / `buttonUrl`, the field was not on the list,
 * and **19 email buttons silently never rendered**. Every existing test passed
 * throughout, because each one stopped at "the notice built the right object".
 *
 * So this asserts the rendered HTML. A button that does not reach the string is a
 * failure here, whatever the object looked like on the way.
 *
 * No database: everything below is a pure function or a notice whose only
 * dependency is the stubbed `notify`.
 */

const oid = () => new mongoose.Types.ObjectId();

/** The bases every button is built from. Unset, the button is omitted by design. */
const PANEL_ENV = {
  VENDOR_PANEL_URL: "https://vendor.trydood.test",
  ADMIN_PANEL_URL: "https://admin.trydood.test",
  PUBLIC_API_URL: "https://api.trydood.test",
  // The customer app's universal-link host. Without it every customer email
  // loses its button, so it is set here rather than left to the environment.
  CUSTOMER_APP_URL: "https://app.trydood.test",
};

const originalEnv = {};

beforeAll(() => {
  for (const [key, value] of Object.entries(PANEL_ENV)) {
    originalEnv[key] = process.env[key];
    process.env[key] = value;
  }
});

afterAll(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => mockNotify.mockClear());

/**
 * The **buttons**, by their `data-cta` marker.
 *
 * ⚠️ Not "every anchor". Each button is now followed by a plain-text fallback
 * link carrying the same URL, so counting anchors would double every result.
 * Matching the marker rather than the inline style also survives someone
 * changing the padding.
 */
const buttonsIn = (html) =>
  [
    ...html.matchAll(/<a data-cta="(?:primary|secondary)" href="([^"]*)"[^>]*>([^<]*)<\/a>/g),
  ].map((match) => ({ url: match[1], label: match[2] }));

/** The copy-and-paste links under the buttons. */
const fallbacksIn = (html) =>
  [...html.matchAll(/<a data-cta-fallback="1" href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map(
    (match) => ({ url: match[1], text: match[2] }),
  );

/** Render a captured `notify` payload the way `sendMail` would. */
const renderNotice = (payload) =>
  renderMailHtml({
    title: payload?.mail?.title || payload?.title,
    body: payload?.mail?.body || payload?.body,
    ...(payload?.mail || {}),
  });

// ---------------------------------------------------------------------------
// The normaliser
// ---------------------------------------------------------------------------

describe("normaliseActions accepts every shape a caller might use", () => {
  it("takes the canonical ctaLabel / ctaUrl pair", () => {
    expect(
      normaliseActions({ ctaLabel: "View settlement", ctaUrl: "https://x/y" }),
    ).toEqual([{ label: "View settlement", url: "https://x/y" }]);
  });

  it("takes an actions array, in order", () => {
    expect(
      normaliseActions({
        actions: [
          { label: "Download Invoice", url: "https://x/i" },
          { label: "View order", url: "https://x/o" },
        ],
      }),
    ).toEqual([
      { label: "Download Invoice", url: "https://x/i" },
      { label: "View order", url: "https://x/o" },
    ]);
  });

  it("combines an actions array with a ctaLabel pair", () => {
    const actions = normaliseActions({
      actions: [{ label: "Primary", url: "https://x/1" }],
      ctaLabel: "Secondary",
      ctaUrl: "https://x/2",
    });

    expect(actions.map((a) => a.label)).toEqual(["Primary", "Secondary"]);
  });

  it("returns nothing when the caller asked for no button", () => {
    expect(normaliseActions({})).toEqual([]);
    expect(normaliseActions()).toEqual([]);
  });

  /**
   * ⚠️ The actual bug, as a test.
   *
   * The old name still has to render — the whole point is that a field nobody
   * remembers must not cost a button a second time — and it has to say so.
   */
  it("still renders the legacy buttonText / buttonUrl, and warns", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const actions = normaliseActions({
      buttonText: "Legacy Spelling",
      buttonUrl: "https://x/legacy",
    });

    expect(actions).toEqual([
      { label: "Legacy Spelling", url: "https://x/legacy" },
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("buttonText/buttonUrl"),
    );

    warn.mockRestore();
  });

  /**
   * A label whose URL builder returned `undefined` — the unset-env case.
   * Omitted on purpose (a hostless link is worse than none) but never silently:
   * from the outside this is indistinguishable from the field-name bug.
   */
  it("omits a button with no URL, and warns so it is not mistaken for the bug", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    expect(normaliseActions({ ctaLabel: "Unreachable Panel" })).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("VENDOR_PANEL_URL"),
    );

    warn.mockRestore();
  });

  it("omits a URL with no label", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    expect(normaliseActions({ ctaUrl: "https://x/unlabelled" })).toEqual([]);

    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// The renderer
// ---------------------------------------------------------------------------

describe("renderMailHtml puts the buttons in the HTML", () => {
  it("renders one anchor with the label and href given", () => {
    const html = renderMailHtml({
      title: "Payout sent",
      body: "Your money is on its way.",
      ctaLabel: "View settlement",
      ctaUrl: "https://vendor.trydood.test/settlements/1",
    });

    expect(buttonsIn(html)).toEqual([
      {
        label: "View settlement",
        url: "https://vendor.trydood.test/settlements/1",
      },
    ]);
  });

  it("renders two anchors when two actions are given", () => {
    const html = renderMailHtml({
      title: "Payment successful",
      body: "Here is your receipt.",
      actions: [
        { label: "Download Invoice", url: "https://api.trydood.test/i/tok" },
        { label: "View your orders", url: "https://api.trydood.test/orders" },
      ],
    });

    expect(buttonsIn(html)).toHaveLength(2);
    // The first is the suggested action and is filled; the rest are outlined.
    expect(html).toMatch(/background:#0f766e;color:#fff[^>]*>Download Invoice/);
    expect(html).toMatch(/border:1px solid #0f766e[^>]*>View your orders/);
  });

  it("renders no anchor at all when there is nothing to click", () => {
    const html = renderMailHtml({ title: "FYI", body: "Nothing to do." });

    expect(buttonsIn(html)).toEqual([]);
    expect(fallbacksIn(html)).toEqual([]);
    // Not a stray sentence about a button that is not there.
    expect(html).not.toMatch(/copy and paste/i);
  });

  /**
   * ⚠️ The fallback is not decoration.
   *
   * Outlook renders a styled anchor as bare text, a text-only client drops the
   * href entirely, a corporate gateway rewrites it, and a reader who is rightly
   * suspicious of a button in an email about their **bank account** wants to see
   * where it goes first. In every one of those cases the printed URL is the only
   * way through.
   */
  it("prints the URL under a single button, as text and as a link", () => {
    const url = "https://vendor.trydood.test/settlements/1";
    const html = renderMailHtml({
      title: "Payout sent",
      body: "b",
      ctaLabel: "View settlement",
      ctaUrl: url,
    });

    expect(fallbacksIn(html)).toEqual([{ url, text: url }]);
    expect(html).toMatch(/If the button above doesn't work/);
  });

  it("labels each URL when there is more than one button", () => {
    const html = renderMailHtml({
      title: "Payment successful",
      body: "b",
      actions: [
        { label: "Download Invoice", url: "https://api.trydood.test/i/tok" },
        { label: "View your order", url: "https://app.trydood.test/orders/1" },
      ],
    });

    expect(fallbacksIn(html)).toEqual([
      { url: "https://api.trydood.test/i/tok", text: "https://api.trydood.test/i/tok" },
      { url: "https://app.trydood.test/orders/1", text: "https://app.trydood.test/orders/1" },
    ]);
    // Ambiguous without them once there are two.
    expect(html).toContain("Download Invoice —");
    expect(html).toContain("View your order —");
  });

  it("gives every button a fallback, and no more than one each", () => {
    const html = renderMailHtml({
      title: "t",
      body: "b",
      actions: [
        { label: "One", url: "https://x/1" },
        { label: "Two", url: "https://x/2" },
        { label: "Three", url: "https://x/3" },
      ],
    });

    expect(buttonsIn(html)).toHaveLength(3);
    expect(fallbacksIn(html)).toHaveLength(3);
  });

  it("escapes a label and a URL rather than trusting them", () => {
    const html = renderMailHtml({
      title: "t",
      body: "b",
      ctaLabel: '"><script>alert(1)</script>',
      ctaUrl: 'https://x/?a="onload="evil()',
    });

    expect(html).not.toMatch(/<script>/);
    expect(html).toContain("&quot;");
  });

  it("still renders the detail table and the footnote", () => {
    const html = renderMailHtml({
      title: "t",
      body: "b",
      lines: [["Amount", "₹810.00"]],
      footnote: "Read this bit too.",
      ctaLabel: "Go",
      ctaUrl: "https://x/y",
    });

    expect(html).toContain("Amount");
    expect(html).toContain("₹810.00");
    expect(html).toContain("Read this bit too.");
    expect(buttonsIn(html)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Every real notice that asks for a button
// ---------------------------------------------------------------------------

const settlement = (overrides = {}) => ({
  _id: oid(),
  brandId: oid(),
  settlementNumber: "TD/STL/26-27/000123",
  periodStart: new Date("2026-08-01T00:00:00Z"),
  periodEnd: new Date("2026-08-31T18:29:59Z"),
  netPayable: 4523.75,
  grossCollected: 9000,
  status: SETTLEMENT_STATUS.PENDING_APPROVAL,
  attemptCount: 0,
  bankSnapshot: { accountLast4Digits: "7890" },
  ...overrides,
});

const request = (overrides = {}) => ({
  _id: oid(),
  brandId: oid(),
  claimId: oid(),
  transactionId: oid(),
  claimCode: "TD-ABC123",
  requestedAmount: 810,
  approvedAmount: 810,
  attemptCount: 1,
  status: REFUND_REQUEST_STATUS.REQUESTED,
  vendorRespondBy: new Date("2026-09-02T00:00:00Z"),
  bankDetailsRequestedAt: new Date("2026-08-10T00:00:00Z"),
  ...overrides,
});

const claim = (overrides = {}) => ({
  _id: oid(),
  customerId: oid(),
  brandId: oid(),
  subBrandId: oid(),
  voucherId: oid(),
  claimCode: "TD-CLM-9001",
  brandSnapshot: { name: "ABC Salon" },
  outletSnapshot: { storeId: "Andheri West" },
  voucherSnapshot: { name: "Flat 30% off" },
  pricing: {
    billAmount: 1000,
    totalPayable: 810,
    youSaved: 190,
    vendorPayable: 700,
  },
  paidAt: new Date("2026-09-01T10:30:00Z"),
  ...overrides,
});

const leg = { _id: oid(), legNumber: 2, amount: 2000, initiatedAt: new Date() };

/**
 * Notices whose whole reason for having a mail body is the button on it.
 *
 * Every one of these was broken. `helpers/notifications/index.js` is the barrel,
 * so a notice renamed or dropped fails here rather than going quiet.
 */
const withButtons = [
  [
    "claim paid — invoice + order",
    () =>
      notices.notifyClaimPaid({
        claim: claim(),
        transaction: { _id: oid(), invoiceId: "INV-1", invoiceToken: "tok123" },
      }),
    ["Download Invoice", "View your order"],
  ],
  [
    "vendor claim received",
    () => notices.notifyVendorClaimReceived({ claim: claim() }),
    ["Open Dashboard"],
  ],
  // ---------------- the customer emails that had no button at all ----------------
  [
    "claim failed (customer)",
    () => notices.notifyClaimFailed({ claim: claim(), reason: "bank declined" }),
    ["Try again"],
  ],
  [
    "claim refunded (customer)",
    () =>
      notices.notifyClaimRefunded({
        claim: claim(),
        transaction: { _id: oid() },
        amount: 810,
        reference: "rfnd_1",
      }),
    ["View refund"],
  ],
  [
    "claim expired (customer)",
    () => notices.notifyClaimExpired({ claim: claim() }),
    ["View your order"],
  ],
  [
    "refund requested (customer)",
    () => notices.notifyCustomerRefundRequested({ request: request() }),
    ["Track your refund"],
  ],
  [
    "refund approved (customer)",
    () => notices.notifyCustomerRefundApproved({ request: request() }),
    ["Track your refund"],
  ],
  [
    "refund rejected (customer)",
    () =>
      notices.notifyCustomerRefundRejected({
        request: request({ status: REFUND_REQUEST_STATUS.VENDOR_REJECTED }),
      }),
    ["Contact support"],
  ],
  /**
   * ⚠️ The one that asks for a bank account. Its button must be the app, never a
   * web form — see the note in `refundNotices.js`.
   */
  [
    "bank details requested (customer)",
    () =>
      notices.notifyRefundBankDetailsRequested({
        request: request({
          status: REFUND_REQUEST_STATUS.AWAITING_BANK_DETAILS,
        }),
      }),
    ["Add your bank account"],
  ],
  [
    "bank details reminder (customer)",
    () =>
      notices.notifyRefundBankDetailsReminder({
        request: request({
          status: REFUND_REQUEST_STATUS.AWAITING_BANK_DETAILS,
        }),
        stage: 2,
      }),
    ["Add your bank account"],
  ],
  [
    "settlement paid",
    () =>
      notices.notifyVendorSettlementPaid({
        settlement: settlement({ status: SETTLEMENT_STATUS.PAID }),
        utr: "N123456789",
      }),
    "View settlement",
  ],
  [
    "settlement failed",
    () =>
      notices.notifyVendorSettlementFailed({
        settlement: settlement({ status: SETTLEMENT_STATUS.FAILED }),
        reason: "BANK_REJECTED",
      }),
    "View settlement",
  ],
  [
    "settlement on hold",
    () => notices.notifyVendorSettlementOnHold({ settlement: settlement() }),
    "View settlement",
  ],
  [
    "settlement carried forward",
    () =>
      notices.notifyVendorSettlementCarriedForward({
        settlement: settlement({ netPayable: -450 }),
        refundAdjustment: 300,
        chargebackAdjustment: 150,
      }),
    "View statement",
  ],
  [
    "settlement stuck (admin)",
    () =>
      notices.notifyAdminSettlementStuck({
        settlement: settlement({ status: SETTLEMENT_STATUS.PROCESSING }),
        leg,
        hours: 9,
      }),
    "Open settlement",
  ],
  [
    "settlement late (admin)",
    () =>
      notices.notifyAdminSettlementLate({ settlement: settlement(), hours: 120 }),
    "Open settlement",
  ],
  [
    "ledger drift (admin)",
    () =>
      notices.notifyAdminSettlementLedgerDrift({
        settlement: settlement(),
        legTotal: 4523.75,
        ledgerTotal: 4000,
      }),
    "Open settlement",
  ],
  [
    "vendor debt aged (admin)",
    () =>
      notices.notifyAdminVendorDebtAged({
        brandId: oid(),
        brandName: "ABC Salon",
        outstanding: 1200,
        ageDays: 95,
        counts: { disputes: 1, refunds: 2 },
        writeOffDays: 90,
      }),
    "Open settlements",
  ],
  [
    "vendor refund requested",
    () =>
      notices.notifyVendorRefundRequested({
        request: request(),
        claim: claim(),
      }),
    "Review Refund",
  ],
  [
    "vendor refund reminder",
    () => notices.notifyVendorRefundReminder({ request: request() }),
    "Review Refund",
  ],
  [
    "refund escalated (admin)",
    () => notices.notifyAdminRefundEscalated({ request: request() }),
    "Open Refunds",
  ],
  [
    "refund failed (admin)",
    () =>
      notices.notifyAdminRefundFailed({
        request: request(),
        reason: "instrument does not accept refunds",
      }),
    "Open Refunds",
  ],
  [
    "bank details stale (admin)",
    () =>
      notices.notifyAdminBankDetailsStale({
        request: request(),
        daysWaiting: 21,
      }),
    "Open refund",
  ],
  [
    "dispute raised (vendor)",
    () =>
      notices.notifyVendorDisputeRaised({
        dispute: { _id: oid(), disputeId: "disp_1", amount: 810 },
        transaction: { _id: oid(), brandId: oid(), invoiceId: "INV-1" },
        claimCode: "TD-ABC123",
      }),
    "Open dispute",
  ],
  [
    "dispute resolved (vendor)",
    () =>
      notices.notifyVendorDisputeResolved({
        dispute: { _id: oid(), disputeId: "disp_1", amount: 810 },
        transaction: { _id: oid(), brandId: oid(), paidAmount: 810 },
        claimCode: "TD-ABC123",
        won: false,
      }),
    "Open dispute",
  ],
  [
    "shadow index reaped (admin)",
    () =>
      notices.notifyAdminShadowIndexReaped({
        reaped: [
          {
            collection: "transactions",
            index: "invoiceId_1",
            replacedBy: "txn_invoice_unique",
          },
        ],
        blocked: [],
      }),
    "Open admin panel",
  ],
];

/** A case may name one button or several; both are read the same way. */
const expectedLabelsOf = (expected) =>
  Array.isArray(expected) ? expected : [expected];

/**
 * A file's source with its comments removed.
 *
 * ⚠️ The two static guards below scan for a mistake by name — and both mistakes
 * are *described* in the comments that warn about them. Scanning the raw source
 * makes every warning its own violation, which is a guard that fails the moment
 * somebody documents the thing it protects.
 */
const codeOf = (file) =>
  fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

/** Every helper in the notifications folder, comments stripped. */
const noticeSources = (exclude = []) => {
  const dir = path.join(__dirname, "../../helpers/notifications");

  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".js") && !exclude.includes(file))
    .map((file) => ({ file, source: codeOf(path.join(dir, file)) }));
};

describe("every notice that asks for a button actually renders one", () => {
  it.each(withButtons)("%s", async (label, build, expected) => {
    await build();

    expect(mockNotify).toHaveBeenCalledTimes(1);

    const html = renderNotice(mockNotify.mock.calls[0][0]);
    const buttons = buttonsIn(html);
    const wanted = expectedLabelsOf(expected);

    expect({ label, buttons: buttons.map((b) => b.label) }).toEqual({
      label,
      buttons: wanted,
    });

    for (const button of buttons) {
      expect({ label, url: button.url }).toEqual({
        label,
        url: expect.stringMatching(/^https:\/\//),
      });
    }
  });

  /**
   * ⚠️ A missing `ADMIN_PATHS` / `PANEL_PATHS` / `CUSTOMER_PATHS` key does not
   * throw — it produces the string "undefined" in the path, and the mail still
   * sends with a button that goes nowhere. Nobody finds out until somebody taps
   * one.
   */
  it.each(withButtons)("%s links somewhere real", async (label, build) => {
    await build();

    for (const { url } of buttonsIn(renderNotice(mockNotify.mock.calls[0][0]))) {
      expect({ label, url }).toEqual({
        label,
        url: expect.not.stringContaining("undefined"),
      });
      expect({ label, url }).toEqual({
        label,
        url: expect.not.stringContaining("null"),
      });
    }
  });

  /** Every button, in every notice, is also printed as a copy-and-paste URL. */
  it.each(withButtons)("%s prints its URL as a fallback", async (label, build) => {
    await build();

    const html = renderNotice(mockNotify.mock.calls[0][0]);
    const buttons = buttonsIn(html);
    const fallbacks = fallbacksIn(html);

    expect({ label, fallbacks: fallbacks.map((f) => f.url) }).toEqual({
      label,
      fallbacks: buttons.map((b) => b.url),
    });
  });
});

// ---------------------------------------------------------------------------
// Dates and times
// ---------------------------------------------------------------------------

describe("dates read the same way everywhere, in IST", () => {
  const {
    formatDate,
    formatDateTime,
    formatDateRange,
  } = require("../../helpers/notifications/formatDateTime");

  /**
   * ⚠️ The bug this guards.
   *
   * Every notice helper formatted with `toLocaleString("en-IN", …)` and **no
   * `timeZone`**, so production (UTC) printed a refund deadline five and a half
   * hours early. `TZ` is forced to UTC below precisely because that is the
   * environment that was wrong — on an IST machine the old code looked correct.
   */
  const AT_2130_IST = new Date("2026-09-02T16:00:00Z"); // 21:30 IST

  it("formats a timestamp in IST regardless of the server zone", () => {
    expect(formatDateTime(AT_2130_IST)).toBe("2 Sep 2026 09:30 PM");
  });

  it("rolls the date over when IST is a day ahead of UTC", () => {
    // 20:00 UTC on the 1st is 01:30 IST on the 2nd.
    expect(formatDateTime(new Date("2026-09-01T20:00:00Z"))).toBe(
      "2 Sep 2026 01:30 AM",
    );
  });

  it("says 12 AM at IST midnight, never 24", () => {
    expect(formatDateTime(new Date("2026-09-01T18:30:00Z"))).toBe(
      "2 Sep 2026 12:00 AM",
    );
  });

  it("says 12 PM at IST noon", () => {
    expect(formatDateTime(new Date("2026-09-02T06:30:00Z"))).toBe(
      "2 Sep 2026 12:00 PM",
    );
  });

  /** `Sep`, not `Sept` — ICU disagrees between builds, so this is not left to it. */
  it("abbreviates September as Sep", () => {
    expect(formatDate(new Date("2026-09-02T06:30:00Z"))).toBe("2 Sep 2026");
  });

  it("leaves a day as a day", () => {
    expect(formatDate(AT_2130_IST)).toBe("2 Sep 2026");
    expect(formatDateRange(
      new Date("2026-08-01T00:00:00Z"),
      new Date("2026-08-31T18:29:59Z"),
    )).toBe("1 Aug 2026 – 31 Aug 2026");
  });

  it("renders a missing or unparseable value as a dash, never Invalid Date", () => {
    for (const value of [null, undefined, "", "not a date"]) {
      expect(formatDateTime(value)).toBe("-");
      expect(formatDate(value)).toBe("-");
    }
  });

  /**
   * The point of the shared helper: the same instant reads identically whether it
   * came from a subscription, a settlement, a refund or a dispute.
   */
  it("no notice helper formats a date on its own any more", () => {
    const offenders = noticeSources(["formatDateTime.js"])
      /**
       * ⚠️ `toLocaleString` alone would false-positive: every one of these files
       * formats **money** with `Number(...).toLocaleString("en-IN", …)`, which is
       * correct and must stay. Only date formatting is the offence, so the third
       * alternative anchors on a `Date(...)` receiver.
       */
      .filter(({ source }) =>
        /toLocaleDateString|toLocaleTimeString|Date\([^)]*\)\.toLocaleString/.test(
          source,
        ),
      )
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The drift itself
// ---------------------------------------------------------------------------

describe("the legacy field name has not come back", () => {
  /**
   * The rename is only worth doing once. `normaliseActions` keeps the old name
   * working, which is deliberate — and which also means a new call site using it
   * would work, warn into a log nobody reads, and quietly re-establish two names
   * for one field. This is the thing that stops that.
   */
  it("no notification helper passes buttonText / buttonUrl", () => {
    const offenders = noticeSources()
      .filter(({ source }) => /\bbutton(Text|Url)\s*:/.test(source))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  /**
   * The same drift, in the services.
   *
   * ⚠️ Eleven admin alerts are raised inline from these files rather than from a
   * notice helper, and every one of them was sent with no `mail` at all. Now that
   * they carry a table and a button, they can drift the same way — and nothing in
   * the notifications folder would notice.
   */
  it("no service passes buttonText / buttonUrl either", () => {
    const roots = [
      path.join(__dirname, "../../services"),
      path.join(__dirname, "../../helpers"),
    ];

    const walk = (dir) =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return entry.name.endsWith(".js") ? [full] : [];
      });

    const offenders = roots
      .flatMap(walk)
      .filter((file) => /\bbutton(Text|Url)\s*:/.test(codeOf(file)))
      .map((file) => path.relative(path.join(__dirname, "../.."), file));

    expect(offenders).toEqual([]);
  });
});
