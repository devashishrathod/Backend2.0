/**
 * Send every notification email this platform produces to one address, for review.
 *
 *     node scripts/sendTestNotificationMails.js --to=you@example.com
 *     node scripts/sendTestNotificationMails.js --to=you@example.com --apply
 *     node scripts/sendTestNotificationMails.js --to=a@x.com,b@x.com,c@x.com --apply
 *     node scripts/sendTestNotificationMails.js --to=you@example.com --only=VENDOR
 *     node scripts/sendTestNotificationMails.js --to=you@example.com --only=SETTLEMENT --apply
 *
 * ⚠️ Customer buttons need `CUSTOMER_APP_URL`. Unset, the ten customer emails
 * arrive with no button — which the dry-run table reports rather than hides.
 *
 * ### Why it does not go through `notify()`
 *
 * `notify()` resolves the recipient from the **brand, customer or user record** —
 * so pointing it at a review address is not possible, and running it for real
 * would write a `Notification` row per case and mail actual vendors and
 * customers. So `notify` and `notifyAdmins` are stubbed here: every line that
 * builds the message still runs, the payload is captured instead of delivered,
 * and `sendMail` is then called directly with the review address.
 *
 * That means what arrives is byte-for-byte what a real recipient would get —
 * same builder, same renderer — addressed somewhere safe.
 *
 * ### Dry-run by default
 *
 * Like every script here, it prints and changes nothing without `--apply`.
 * Sending is outward-facing and cannot be undone, and the dry run is also the
 * more useful output for checking a link: it lists the CTA label, the CTA URL and
 * the in-app deep link for every case in one table.
 *
 * ⚠️ **The deep link is not in the email.** It is the route the mobile app opens
 * when the in-app row or the push is tapped, and it is listed here only so both
 * destinations can be reviewed together. An email carries the CTA URL.
 *
 * ### What is real and what is not
 *
 * Names, amounts, plans and dates are invented. **Link targets are borrowed from
 * the database where one exists** — an invoice token, a settlement id, a refund
 * request id — so a button opens something that resolves instead of a 404 on a
 * random ObjectId. The run reports which ids were real and which were synthetic.
 */
require("dotenv").config({ quiet: true });

const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "")
  .slice(7)
  .trim()
  .toUpperCase();

const AUDIENCES = ["VENDOR", "CUSTOMER", "ADMIN"];

/**
 * Does this case pass `--only`?
 *
 * ⚠️ This used to be one substring test against `"<audience> <type>"`, and
 * `--only=CUSTOMER` therefore also matched three **vendor** notices —
 * `BRAND_HIDDEN_FROM_CUSTOMERS`, `BRAND_VISIBLE_TO_CUSTOMERS`, and
 * `BRAND_DEACTIVATED (still visible to customers)`. It reported them as sent
 * under a CUSTOMER-only run, so the filter looked like it worked and the count
 * was simply wrong.
 *
 * An audience name is therefore matched **exactly** against the audience, and
 * anything else is a substring match on the type — which is what `--only=REFUND`
 * or `--only=SETTLEMENT` need.
 */
const matchesOnly = (testCase) => {
  if (!ONLY) return true;
  if (AUDIENCES.includes(ONLY)) return testCase.audience === ONLY;
  return testCase.type.toUpperCase().includes(ONLY);
};

/**
 * Recipients — comma-separated, so a whole team can review one run.
 *
 *     --to=dev@x.com,qa@x.com,founder@x.com
 *
 * ⚠️ One `sendMail` per case, addressed to **all** of them, rather than one send
 * per person per case. Ten reviewers would otherwise be 650 messages through one
 * Gmail account, which is past its 500-a-day cap — the run would start failing
 * somewhere in the middle with an error that reads like a credential problem.
 *
 * The consequence is that reviewers see each other in the `To` header. For a
 * team reviewing their own templates that is fine, and it is the honest trade:
 * the alternative is a run that does not finish.
 */
const RECIPIENTS = (process.argv.find((a) => a.startsWith("--to=")) || "")
  .slice(5)
  .split(",")
  .map((address) => address.trim())
  .filter(Boolean);

/**
 * Deliberately loose. This is a review script, and the addresses are typed by
 * the person running it — the check exists to catch a stray comma or a shell
 * mangling the argument, not to validate an address the RFC allows.
 */
const LOOKS_LIKE_EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

const TO = RECIPIENTS.join(", ");

/**
 * ⚠️ The notice modules destructure `{ notify }` at **load** time, so the stub has
 * to be in place before the barrel is required. Mutating the module's own exports
 * object — rather than faking a `require.cache` entry — keeps every other export
 * on it intact.
 */
const notifyModule = require("../helpers/notifications/notify");
const notifyAdminsModule = require("../helpers/notifications/notifyAdmins");

let captured = [];

notifyModule.notify = async (args) => {
  captured.push({ ...args, via: "notify" });
  return { created: true };
};

notifyAdminsModule.notifyAdmins = async (args) => {
  // `notifyAdmins` fans out to one row per admin and labels the audience itself.
  captured.push({ ...args, audience: "ADMIN", via: "notifyAdmins" });
  return { created: 1 };
};

const notices = require("../helpers/notifications");
const { ADMIN_PATHS, adminUrl, deepLink } = require("../helpers/notifications");
const {
  formatDateTime,
} = require("../helpers/notifications/formatDateTime");
const { sendMail } = require("../helpers/nodeMailer");
const { normaliseActions } = require("../helpers/nodeMailer/sendMail");
const { SUBSCRIPTION_ACTION } = require("../constants/subscription");
const { REFUND_REQUEST_STATUS } = require("../constants/refund");
const { SETTLEMENT_STATUS } = require("../constants/settlement");

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// Link targets — real where the database has one
// ---------------------------------------------------------------------------

const REAL = { sources: {} };

/**
 * Read-only, and through the raw driver rather than the models on purpose:
 * requiring a model would let Mongoose check and build its indexes against a
 * live database, which a review script has no business doing.
 */
const loadRealTargets = async () => {
  const db = mongoose.connection.db;

  const pick = async (collection, filter, projection, key) => {
    try {
      const doc = await db.collection(collection).findOne(filter, { projection });
      REAL.sources[key] = doc ? "database" : "synthetic (none found)";
      return doc || null;
    } catch (error) {
      REAL.sources[key] = `synthetic (${error?.message})`;
      return null;
    }
  };

  const txn = await pick(
    "transactions",
    { invoiceToken: { $exists: true, $nin: [null, ""] } },
    { invoiceToken: 1, invoiceId: 1 },
    "invoiceToken",
  );
  const settlement = await pick(
    "settlements",
    {},
    { settlementNumber: 1 },
    "settlementId",
  );
  const refund = await pick("refundrequests", {}, { claimCode: 1 }, "refundRequestId");
  const claim = await pick("voucherclaims", {}, { claimCode: 1 }, "claimId");

  REAL.invoiceToken = txn?.invoiceToken || `test-token-${Date.now()}`;
  REAL.invoiceId = txn?.invoiceId || "TD/INV/26-27/000842";
  REAL.settlementId = settlement?._id || oid();
  REAL.refundRequestId = refund?._id || oid();
  REAL.claimId = claim?._id || oid();
  REAL.transactionId = txn?._id || oid();
};

// ---------------------------------------------------------------------------
// Fixtures — invented, and obviously so
// ---------------------------------------------------------------------------

const brandId = oid();
const userId = oid();

/**
 * A whole brand object, so `resolveBrandIdentity` does not re-read one. The name
 * is invented deliberately: a review mail naming a real vendor could be mistaken
 * for a real notice about them.
 */
const brand = {
  _id: brandId,
  userId,
  brandName: "Chai Point Andheri",
  legalBusinessName: "Chai Point Hospitality Private Limited",
  email: "vendor@example.test",
  mobile: "9876543210",
  uniqueId: "TD-BRD-00417",
  merchantId: "TDM00417",
};

const subscription = { _id: oid(), name: "Prime Plus" };

const subscribed = (overrides = {}) => ({
  _id: oid(),
  brandId,
  endDate: new Date("2027-08-29T00:00:00Z"),
  paidAmount: 1999,
  ...overrides,
});

const settlement = (overrides = {}) => ({
  _id: REAL.settlementId,
  brandId,
  settlementNumber: "TD/STL/26-27/000123",
  periodStart: new Date("2026-08-01T00:00:00Z"),
  periodEnd: new Date("2026-08-31T18:29:59Z"),
  netPayable: 4523.75,
  grossCollected: 9000,
  status: SETTLEMENT_STATUS.PENDING_APPROVAL,
  attemptCount: 0,
  bankSnapshot: { accountLast4Digits: "7890", bankName: "HDFC Bank" },
  ...overrides,
});

const refundRequest = (overrides = {}) => ({
  _id: REAL.refundRequestId,
  brandId,
  claimId: REAL.claimId,
  transactionId: REAL.transactionId,
  customerId: oid(),
  claimCode: "TD-CLM-9001",
  requestedAmount: 810,
  approvedAmount: 810,
  reason: "SERVICE_NOT_PROVIDED",
  reasonNote: "Outlet was closed when I reached at 8pm.",
  attemptCount: 1,
  remindersSent: 1,
  status: REFUND_REQUEST_STATUS.REQUESTED,
  vendorRespondBy: new Date("2026-09-06T18:30:00Z"),
  bankDetailsRequestedAt: new Date("2026-08-14T11:00:00Z"),
  adminNote: "the card used for the payment has since expired",
  ...overrides,
});

const voucherClaim = (overrides = {}) => ({
  _id: REAL.claimId,
  customerId: oid(),
  brandId,
  subBrandId: oid(),
  voucherId: oid(),
  claimCode: "TD-CLM-9001",
  promoCode: "MONSOON20",
  brandSnapshot: { name: "Chai Point Andheri" },
  outletSnapshot: { storeId: "Andheri West — Lokhandwala" },
  voucherSnapshot: { name: "Flat 30% off on total bill" },
  pricing: {
    billAmount: 1000,
    totalPayable: 810,
    youSaved: 190,
    vendorPayable: 700,
  },
  paidAt: new Date("2026-09-01T14:35:00Z"),
  expiresAt: new Date("2026-09-08T14:35:00Z"),
  ...overrides,
});

const transaction = () => ({
  _id: REAL.transactionId,
  brandId,
  invoiceId: REAL.invoiceId,
  invoiceToken: REAL.invoiceToken,
  paidAmount: 810,
  amount: 810,
  razorpayPaymentId: "pay_QxTest0000001",
  disputeId: "disp_QxTest0000001",
  disputeStatus: "UNDER_REVIEW",
  disputeAmount: 810,
  disputeRespondBy: new Date("2026-09-07T18:30:00Z"),
  voucher: { claimCode: "TD-CLM-9001" },
});

const dispute = () => ({
  _id: oid(),
  brandId,
  disputeId: "disp_QxTest0000001",
  amount: 810,
  respondBy: new Date("2026-09-07T18:30:00Z"),
});

const payoutLeg = {
  _id: oid(),
  legNumber: 2,
  amount: 2000,
  initiatedAt: new Date("2026-09-02T16:00:00Z"),
};

// ---------------------------------------------------------------------------
// The cases
// ---------------------------------------------------------------------------

/**
 * A case either **builds** (calls the real notice helper and the payload is
 * captured from the stub) or carries a **literal** payload.
 *
 * ⚠️ The literal ones are the admin alerts raised inline from the services —
 * `WEBHOOK_FAILED`, `PAYMENT_DISPUTED`, `PROMO_LIMIT_EXCEEDED`. Those are built
 * at the call site rather than in a notice helper, and reaching them for real
 * would mean driving a webhook or a settle. Their `title` / `body` / `mail` are
 * copied from the call site, and the run labels them `reconstructed` so nobody
 * reads them as proof that path executed.
 *
 * ⚠️ A function, not an array. The literal payloads below read `REAL.*`, which is
 * only filled once `loadRealTargets` has run — as a top-level array they would
 * capture `undefined` and quietly mail an invoice number reading "undefined".
 */
const makeCases = () => [
  // ---------------- VENDOR · subscription ----------------
  {
    audience: "VENDOR",
    type: "SUBSCRIPTION_ACTIVATED",
    build: () =>
      notices.notifySubscriptionActivated({
        brand,
        subscription,
        subscribed: subscribed(),
        action: SUBSCRIPTION_ACTION.NEW,
      }),
  },
  {
    audience: "VENDOR",
    type: "SUBSCRIPTION_RENEWED",
    build: () =>
      notices.notifySubscriptionActivated({
        brand,
        subscription,
        subscribed: subscribed(),
        action: SUBSCRIPTION_ACTION.RENEW,
      }),
  },
  {
    audience: "VENDOR",
    type: "SUBSCRIPTION_UPGRADED",
    build: () =>
      notices.notifySubscriptionActivated({
        brand,
        subscription: { _id: oid(), name: "Prime Plus" },
        subscribed: subscribed({ paidAmount: 2499 }),
        action: SUBSCRIPTION_ACTION.UPGRADE,
        // The one figure only an upgrade or downgrade carries.
        forfeitedDays: 37,
      }),
  },
  {
    audience: "VENDOR",
    type: "SUBSCRIPTION_DOWNGRADED",
    build: () =>
      notices.notifySubscriptionActivated({
        brand,
        subscription: { _id: oid(), name: "Pro Lite" },
        subscribed: subscribed({ paidAmount: 0 }),
        action: SUBSCRIPTION_ACTION.DOWNGRADE,
      }),
  },
  {
    audience: "VENDOR",
    type: "SUBSCRIPTION_GRANTED",
    build: () =>
      notices.notifySubscriptionActivated({
        brand,
        subscription,
        subscribed: subscribed({ paidAmount: 0 }),
        action: SUBSCRIPTION_ACTION.NEW,
        isAdminGrant: true,
      }),
  },
  {
    audience: "VENDOR",
    type: "SUBSCRIPTION_EXPIRING (7 days · WARNING)",
    build: () =>
      notices.notifySubscriptionExpiring({
        brand,
        subscription,
        subscribed: subscribed({ endDate: new Date("2026-09-11T00:00:00Z") }),
        daysRemaining: 7,
        offset: 7,
      }),
  },
  {
    audience: "VENDOR",
    // ⚠️ A different severity and a different title. Worth seeing both.
    type: "SUBSCRIPTION_EXPIRING (today · CRITICAL)",
    build: () =>
      notices.notifySubscriptionExpiring({
        brand,
        subscription,
        subscribed: subscribed({ endDate: new Date("2026-09-04T00:00:00Z") }),
        daysRemaining: 1,
        offset: 1,
      }),
  },
  {
    audience: "VENDOR",
    type: "SUBSCRIPTION_EXPIRED",
    build: () =>
      notices.notifySubscriptionExpired({
        subscribed: subscribed({ endDate: new Date("2026-09-03T00:00:00Z") }),
        subscription,
      }),
  },
  {
    audience: "VENDOR",
    type: "SUBSCRIPTION_CANCELLED",
    build: () =>
      notices.notifySubscriptionCancelled({
        subscribed: subscribed(),
        subscription,
        reason: "Duplicate account — merged into TD-BRD-00201",
      }),
  },

  // ---------------- VENDOR · brand verification ----------------
  {
    audience: "VENDOR",
    type: "BRAND_UNDER_REVIEW",
    build: () => notices.notifyBrandUnderReview({ brand, attemptNumber: 1, score: 82 }),
  },
  {
    audience: "VENDOR",
    type: "BRAND_RESUBMITTED",
    build: () =>
      notices.notifyBrandUnderReview({
        brand,
        attemptNumber: 2,
        isResubmission: true,
        score: 91,
      }),
  },
  {
    audience: "VENDOR",
    type: "BRAND_APPROVED",
    build: () => notices.notifyBrandApproved({ brand, attemptNumber: 2 }),
  },
  {
    audience: "VENDOR",
    type: "BRAND_REJECTED",
    build: () =>
      notices.notifyBrandRejected({
        brand,
        reason:
          "The GST certificate is registered to a different legal name than the PAN provided.",
        attemptNumber: 1,
      }),
  },
  {
    audience: "VENDOR",
    type: "BRAND_APPROVAL_REVOKED",
    build: () =>
      notices.notifyBrandApprovalRevoked({
        brand,
        reason: "The FSSAI licence on file expired on 12 Aug 2026.",
        attemptNumber: 2,
      }),
  },

  // ---------------- VENDOR · brand status ----------------
  {
    audience: "VENDOR",
    type: "BRAND_DEACTIVATED (still visible to customers)",
    build: () =>
      notices.notifyBrandDeactivated({
        brand,
        reason: "suspected duplicate GST — flagged by ops",
        hiddenFromCustomers: false,
      }),
  },
  {
    audience: "VENDOR",
    // ⚠️ A materially different body — the brand is off the customer app too.
    type: "BRAND_DEACTIVATED (also hidden)",
    build: () =>
      notices.notifyBrandDeactivated({
        brand,
        reason: "suspected duplicate GST — flagged by ops",
        hiddenFromCustomers: true,
      }),
  },
  {
    audience: "VENDOR",
    type: "BRAND_ACTIVATED",
    build: () => notices.notifyBrandActivated({ brand }),
  },
  {
    audience: "VENDOR",
    type: "BRAND_HIDDEN_FROM_CUSTOMERS",
    build: () =>
      notices.notifyBrandCustomerVisibilityChanged({ brand, isVisible: false }),
  },
  {
    audience: "VENDOR",
    type: "BRAND_VISIBLE_TO_CUSTOMERS",
    build: () =>
      notices.notifyBrandCustomerVisibilityChanged({ brand, isVisible: true }),
  },

  // ---------------- VENDOR · claims, settlements, refunds, disputes ----------------
  {
    audience: "VENDOR",
    type: "VOUCHER_CLAIM_RECEIVED",
    build: () => notices.notifyVendorClaimReceived({ claim: voucherClaim() }),
  },
  {
    audience: "VENDOR",
    type: "SETTLEMENT_PAID",
    build: () =>
      notices.notifyVendorSettlementPaid({
        settlement: settlement({ status: SETTLEMENT_STATUS.PAID }),
        utr: "HDFCN52026090412345",
      }),
  },
  {
    audience: "VENDOR",
    type: "SETTLEMENT_FAILED",
    build: () =>
      notices.notifyVendorSettlementFailed({
        settlement: settlement({ status: SETTLEMENT_STATUS.FAILED, attemptCount: 2 }),
        reason: "Beneficiary account closed",
      }),
  },
  {
    audience: "VENDOR",
    type: "SETTLEMENT_ON_HOLD",
    build: () =>
      notices.notifyVendorSettlementOnHold({
        settlement: settlement({ status: SETTLEMENT_STATUS.ON_HOLD }),
      }),
  },
  {
    audience: "VENDOR",
    type: "SETTLEMENT_CARRIED_FORWARD (shortfall)",
    build: () =>
      notices.notifyVendorSettlementCarriedForward({
        settlement: settlement({ netPayable: -450, grossCollected: 3200 }),
        refundAdjustment: 2450,
        chargebackAdjustment: 1200,
      }),
  },
  {
    audience: "VENDOR",
    // ⚠️ The exactly-zero ending. "The remaining ₹0.00 carries forward" would
    // read as a bug, so the copy branches.
    type: "SETTLEMENT_CARRIED_FORWARD (nets to zero)",
    build: () =>
      notices.notifyVendorSettlementCarriedForward({
        settlement: settlement({ netPayable: 0, grossCollected: 3650 }),
        refundAdjustment: 2450,
        chargebackAdjustment: 1200,
      }),
  },
  {
    audience: "VENDOR",
    type: "REFUND_REQUESTED (to the vendor)",
    build: () =>
      notices.notifyVendorRefundRequested({
        request: refundRequest(),
        claim: voucherClaim(),
      }),
  },
  {
    audience: "VENDOR",
    type: "REFUND_REMINDER",
    build: () => notices.notifyVendorRefundReminder({ request: refundRequest() }),
  },
  {
    audience: "VENDOR",
    type: "DISPUTE_RAISED_VENDOR",
    build: () =>
      notices.notifyVendorDisputeRaised({
        dispute: dispute(),
        transaction: transaction(),
        claimCode: "TD-CLM-9001",
      }),
  },
  {
    audience: "VENDOR",
    type: "DISPUTE_RESOLVED_VENDOR (won)",
    build: () =>
      notices.notifyVendorDisputeResolved({
        dispute: dispute(),
        transaction: transaction(),
        claimCode: "TD-CLM-9001",
        won: true,
      }),
  },
  {
    audience: "VENDOR",
    type: "DISPUTE_RESOLVED_VENDOR (lost · recoverable)",
    build: () =>
      notices.notifyVendorDisputeResolved({
        dispute: dispute(),
        transaction: transaction(),
        claimCode: "TD-CLM-9001",
        won: false,
        recoverable: true,
      }),
  },
  {
    audience: "VENDOR",
    // Never settled, so nothing is deducted — a third, different body.
    type: "DISPUTE_RESOLVED_VENDOR (lost · nothing to deduct)",
    build: () =>
      notices.notifyVendorDisputeResolved({
        dispute: dispute(),
        transaction: transaction(),
        claimCode: "TD-CLM-9001",
        won: false,
        recoverable: false,
      }),
  },

  // ---------------- CUSTOMER ----------------
  {
    audience: "CUSTOMER",
    type: "VOUCHER_PAYMENT_SUCCESS (the receipt · Download Invoice)",
    build: () =>
      notices.notifyClaimPaid({ claim: voucherClaim(), transaction: transaction() }),
  },
  {
    audience: "CUSTOMER",
    type: "VOUCHER_PAYMENT_FAILED",
    build: () =>
      notices.notifyClaimFailed({
        claim: voucherClaim(),
        reason: "the bank declined the UPI mandate",
      }),
  },
  {
    audience: "CUSTOMER",
    type: "VOUCHER_REFUNDED",
    build: () =>
      notices.notifyClaimRefunded({
        claim: voucherClaim(),
        transaction: transaction(),
        amount: 810,
        reference: "rfnd_QxTest0000001",
      }),
  },
  {
    audience: "CUSTOMER",
    type: "VOUCHER_CLAIM_EXPIRED",
    build: () => notices.notifyClaimExpired({ claim: voucherClaim() }),
  },
  {
    audience: "CUSTOMER",
    type: "REFUND_REQUESTED (to the customer)",
    build: () => notices.notifyCustomerRefundRequested({ request: refundRequest() }),
  },
  {
    audience: "CUSTOMER",
    type: "REFUND_APPROVED (in full)",
    build: () =>
      notices.notifyCustomerRefundApproved({
        request: refundRequest({
          status: REFUND_REQUEST_STATUS.VENDOR_APPROVED,
          approvedAmount: 810,
        }),
      }),
  },
  {
    audience: "CUSTOMER",
    // ⚠️ Says the shortfall plainly. A customer who asked for ₹810 and receives
    // ₹400 without being told opens a second request and a support ticket.
    type: "REFUND_APPROVED (partial)",
    build: () =>
      notices.notifyCustomerRefundApproved({
        request: refundRequest({
          status: REFUND_REQUEST_STATUS.ADMIN_OVERRIDE,
          approvedAmount: 400,
        }),
      }),
  },
  {
    audience: "CUSTOMER",
    type: "REFUND_REJECTED",
    build: () =>
      notices.notifyCustomerRefundRejected({
        request: refundRequest({ status: REFUND_REQUEST_STATUS.VENDOR_REJECTED }),
      }),
  },
  {
    audience: "CUSTOMER",
    // ⚠️ The only customer notice that asks them to act, and it asks for bank
    // details — read this one as if you were suspicious of it.
    type: "REFUND_BANK_DETAILS_REQUESTED (first ask)",
    build: () =>
      notices.notifyRefundBankDetailsRequested({
        request: refundRequest({
          status: REFUND_REQUEST_STATUS.AWAITING_BANK_DETAILS,
        }),
      }),
  },
  {
    audience: "CUSTOMER",
    type: "REFUND_BANK_DETAILS_REQUESTED (reminder)",
    build: () =>
      notices.notifyRefundBankDetailsReminder({
        request: refundRequest({
          status: REFUND_REQUEST_STATUS.AWAITING_BANK_DETAILS,
        }),
        stage: 2,
      }),
  },

  // ---------------- ADMIN · from notice helpers ----------------
  {
    audience: "ADMIN",
    type: "BRAND_AWAITING_REVIEW",
    build: () =>
      notices.notifyAdminsBrandAwaitingReview({
        brand,
        attemptNumber: 1,
        score: 82,
        systemStatus: "PASSED_WITH_WARNINGS",
      }),
  },
  {
    audience: "ADMIN",
    type: "BRAND_AWAITING_RE_REVIEW",
    build: () =>
      notices.notifyAdminsBrandAwaitingReview({
        brand,
        attemptNumber: 3,
        isResubmission: true,
        score: 91,
        systemStatus: "PASSED",
      }),
  },
  {
    audience: "ADMIN",
    type: "REFUND_ESCALATED",
    build: () =>
      notices.notifyAdminRefundEscalated({
        request: refundRequest({ status: REFUND_REQUEST_STATUS.VENDOR_TIMEOUT }),
      }),
  },
  {
    audience: "ADMIN",
    type: "REFUND_FAILED",
    build: () =>
      notices.notifyAdminRefundFailed({
        request: refundRequest({
          status: REFUND_REQUEST_STATUS.FAILED,
          attemptCount: 3,
        }),
        reason: "the instrument does not accept refunds",
      }),
  },
  {
    audience: "ADMIN",
    type: "REFUND_BANK_DETAILS_STALE",
    build: () =>
      notices.notifyAdminBankDetailsStale({
        request: refundRequest({
          status: REFUND_REQUEST_STATUS.AWAITING_BANK_DETAILS,
        }),
        daysWaiting: 21,
      }),
  },
  {
    audience: "ADMIN",
    type: "SETTLEMENT_STUCK (PROCESSING)",
    build: () =>
      notices.notifyAdminSettlementStuck({
        settlement: settlement({ status: SETTLEMENT_STATUS.PROCESSING }),
        leg: payoutLeg,
        hours: 9,
      }),
  },
  {
    audience: "ADMIN",
    // ⚠️ Carries the extra warning that the transfer may never have been keyed in.
    type: "SETTLEMENT_STUCK (APPROVED · orphan leg)",
    build: () =>
      notices.notifyAdminSettlementStuck({
        settlement: settlement({ status: SETTLEMENT_STATUS.APPROVED }),
        leg: payoutLeg,
        hours: 14,
      }),
  },
  {
    audience: "ADMIN",
    type: "SETTLEMENT_LATE",
    build: () =>
      notices.notifyAdminSettlementLate({ settlement: settlement(), hours: 120 }),
  },
  {
    audience: "ADMIN",
    type: "SETTLEMENT_LEDGER_DRIFT",
    build: () =>
      notices.notifyAdminSettlementLedgerDrift({
        settlement: settlement(),
        legTotal: 4523.75,
        ledgerTotal: 4000,
      }),
  },
  {
    audience: "ADMIN",
    type: "VENDOR_DEBT_AGED",
    build: () =>
      notices.notifyAdminVendorDebtAged({
        brandId,
        brandName: brand.brandName,
        outstanding: 3650,
        ageDays: 95,
        counts: { disputes: 1, refunds: 2 },
        writeOffDays: 90,
      }),
  },
  {
    audience: "ADMIN",
    type: "SHADOW_INDEX_REAPED",
    build: () =>
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
  },
  {
    audience: "ADMIN",
    type: "DISPUTE_DEADLINE (24h left)",
    build: () =>
      notices.notifyDisputeDeadline({ transaction: transaction(), hoursLeft: 19 }),
  },
  {
    audience: "ADMIN",
    type: "DISPUTE_DEADLINE (overdue)",
    build: () =>
      notices.notifyDisputeDeadline({
        transaction: transaction(),
        hoursLeft: -6,
        isOverdue: true,
      }),
  },

  // ---------------- ADMIN · raised inline from the services ----------------
  // ⚠️ Reconstructed from the call site — see the note above the array.
  {
    audience: "ADMIN",
    type: "WEBHOOK_FAILED · no settler for a captured payment",
    reconstructed: "services/transactions/handleRazorpayWebhook.js",
    payload: {
      title: "No settlement path for a captured payment",
      body: `Transaction ${REAL.invoiceId} has purpose "VOUCHER_CLAIM_LEGACY", which has no settler. The money is captured and nothing has been activated. Known purposes: SUBSCRIPTION, VOUCHER_CLAIM.`,
      deepLink: deepLink(ADMIN_PATHS.transaction(REAL.transactionId)),
      mail: {
        lines: [
          ["Invoice", REAL.invoiceId],
          ["Purpose", "VOUCHER_CLAIM_LEGACY"],
          ["Gateway account", "CUSTOMER"],
          ["Razorpay order", "order_QxTest0000001"],
          ["Known purposes", "SUBSCRIPTION, VOUCHER_CLAIM"],
        ],
        ctaLabel: "Open transaction",
        ctaUrl: adminUrl(ADMIN_PATHS.transaction(REAL.transactionId)),
      },
    },
  },
  {
    audience: "ADMIN",
    type: "WEBHOOK_FAILED · delivered to the wrong endpoint",
    reconstructed: "services/transactions/handleRazorpayWebhook.js",
    payload: {
      title: "Razorpay webhook delivered to the wrong endpoint",
      body: 'A CUSTOMER account delivery ("payment.captured") arrived on the VENDOR webhook URL. It was processed, but the CUSTOMER dashboard should point at /transactions/webhook/razorpay/customer.',
      deepLink: deepLink(ADMIN_PATHS.WEBHOOKS),
      mail: {
        lines: [
          ["Event", "payment.captured"],
          ["Arrived on", "VENDOR endpoint"],
          ["Signed by", "CUSTOMER account"],
          ["Should point at", "/transactions/webhook/razorpay/customer"],
        ],
        ctaLabel: "Open webhook log",
        ctaUrl: adminUrl(ADMIN_PATHS.WEBHOOKS),
        footnote:
          "Fix the endpoint in the Razorpay dashboard for that account — this delivery was processed, but the misconfiguration breaks the day the two secrets diverge.",
      },
    },
  },
  {
    audience: "ADMIN",
    type: "WEBHOOK_FAILED · a verified delivery could not be processed",
    reconstructed: "services/transactions/handleRazorpayWebhook.js",
    payload: {
      title: "Webhook could not be processed — payment.captured",
      body: "A verified payment.captured delivery failed: Cannot read properties of undefined (reading 'brandId'). The payload is stored and can be replayed once the cause is fixed.",
      deepLink: deepLink(ADMIN_PATHS.webhook(REAL.transactionId)),
      mail: {
        lines: [
          ["Event", "payment.captured"],
          ["Error", "Cannot read properties of undefined (reading 'brandId')"],
          ["Razorpay order", "order_QxTest0000001"],
          ["Razorpay payment", "pay_QxTest0000001"],
          ["Event id", "evt_QxTest0000001"],
        ],
        ctaLabel: "Open webhook & replay",
        ctaUrl: adminUrl(ADMIN_PATHS.webhook(REAL.transactionId)),
        footnote:
          "Razorpay will not retry this — it already has our 200. The stored payload is the only way back in.",
      },
    },
  },
  {
    audience: "ADMIN",
    type: "WEBHOOK_FAILED · double capture on one order",
    reconstructed: "helpers/transactions/detectDoubleCapture.js",
    payload: {
      title: "Double capture on order order_QxTest0000001",
      body: "Razorpay captured a second payment (pay_QxTest0000002) on an order that was already settled with pay_QxTest0000001. The customer has been charged twice — ₹810.00 needs refunding from the CUSTOMER account.",
      deepLink: deepLink(ADMIN_PATHS.transaction(REAL.transactionId)),
      mail: {
        lines: [
          ["Order", "order_QxTest0000001"],
          ["Already settled with", "pay_QxTest0000001"],
          ["Second capture", "pay_QxTest0000002"],
          ["Amount", "₹810.00"],
          ["Account", "CUSTOMER"],
        ],
        ctaLabel: "Open transaction",
        ctaUrl: adminUrl(ADMIN_PATHS.transaction(REAL.transactionId)),
        footnote:
          "Refund the duplicate payment from the Razorpay dashboard for that account.",
      },
    },
  },
  {
    audience: "ADMIN",
    type: "WEBHOOK_FAILED · once-per-user slot conflict",
    reconstructed: "helpers/voucherClaims/settleVoucherClaimPayment.js",
    payload: {
      title: "Once-per-user slot conflict on claim TD-CLM-9001",
      body: "A payment captured for claim TD-CLM-9001 after another claim had taken the same once-per-user slot. The payment was settled — the customer has been charged — but the offer was redeemed twice. Decide whether to refund one of them.",
      deepLink: deepLink(ADMIN_PATHS.claim(REAL.claimId)),
      mail: {
        lines: [
          ["Claim code", "TD-CLM-9001"],
          ["Amount charged", "810"],
          ["Transaction", String(REAL.transactionId)],
        ],
        actions: [
          { label: "Open claim", url: adminUrl(ADMIN_PATHS.claim(REAL.claimId)) },
          {
            label: "Open transaction",
            url: adminUrl(ADMIN_PATHS.transaction(REAL.transactionId)),
          },
        ],
        footnote:
          "The payment is settled and the customer has been charged — nothing is broken. The decision is whether the second redemption should be refunded.",
      },
    },
  },
  {
    audience: "ADMIN",
    type: "WEBHOOK_FAILED · voucher promo past its cap",
    reconstructed: "helpers/voucherClaims/settleVoucherClaimPayment.js",
    payload: {
      title: "Promo code MONSOON20 went past its limit",
      body: "A payment captured after the reservation for MONSOON20 had lapsed. The discount was honoured because the money was taken at that price, so the code is now over its cap.",
      deepLink: deepLink(ADMIN_PATHS.promo("MONSOON20")),
      mail: {
        lines: [
          ["Promo code", "MONSOON20"],
          ["Claim code", "TD-CLM-9001"],
          ["Discount honoured", "190"],
        ],
        ctaLabel: "Open promo code",
        ctaUrl: adminUrl(ADMIN_PATHS.promo("MONSOON20")),
        footnote:
          "Nothing to undo — the money was taken at that price. Lower the cap or close the code if it should stop here.",
      },
    },
  },
  {
    audience: "ADMIN",
    type: "WEBHOOK_FAILED · settlements could not be resumed",
    reconstructed: "services/voucherClaims/claimJobs.js",
    payload: {
      title: "3 voucher settlement(s) could not be resumed",
      body: "Money was captured and the settlement never finished. Each of these has a customer who paid and a vendor who has not been credited.",
      deepLink: deepLink(ADMIN_PATHS.TRANSACTIONS),
      mail: {
        lines: [
          ["Could not resume", "3"],
          ["Stranded settlements found", "7"],
          ["Checked at", formatDateTime(new Date())],
        ],
        ctaLabel: "Open transactions",
        ctaUrl: adminUrl(ADMIN_PATHS.TRANSACTIONS),
        footnote:
          "Every step of a settle is idempotent, so these are safe to resume again once the cause is fixed.",
      },
    },
  },
  {
    audience: "ADMIN",
    type: "WEBHOOK_FAILED · recovered by reconciliation",
    reconstructed: "services/voucherClaims/claimJobs.js",
    payload: {
      title: "A captured payment was recovered by reconciliation",
      body: "Payment pay_QxTest0000001 was captured but neither the webhook nor the browser callback settled it. It has been settled now — worth checking why the webhook did not arrive.",
      deepLink: deepLink(ADMIN_PATHS.transaction(REAL.transactionId)),
      mail: {
        lines: [
          ["Razorpay payment", "pay_QxTest0000001"],
          ["Recovered at", formatDateTime(new Date())],
          ["Status", "Settled by reconciliation"],
        ],
        ctaLabel: "Open transaction",
        ctaUrl: adminUrl(ADMIN_PATHS.transaction(REAL.transactionId)),
        footnote:
          "Nothing is owed — this is already settled. The reason the webhook never arrived is what needs looking at.",
      },
    },
  },
  {
    audience: "ADMIN",
    type: "WEBHOOK_FAILED · authorized but never captured",
    reconstructed: "services/voucherClaims/claimJobs.js",
    payload: {
      title: "4 payment(s) authorized but never captured",
      body: "These have been held by the bank without being taken for over 30 minutes. Razorpay auto-refunds an uncaptured authorization after about five days, which the customer sees as a silent failure. Check that auto-capture is enabled on the CUSTOMER account.",
      deepLink: deepLink(ADMIN_PATHS.TRANSACTIONS),
      mail: {
        lines: [
          ["Stuck payments", "4"],
          [
            "Oldest authorized at",
            formatDateTime(new Date(Date.now() - 95 * 60 * 1000)),
          ],
          ["Alert threshold", "30 minutes"],
          ["Examples", "pay_QxTest0000001, pay_QxTest0000002"],
        ],
        ctaLabel: "Open transactions",
        ctaUrl: adminUrl(ADMIN_PATHS.TRANSACTIONS),
        footnote:
          "If this fired at all, auto-capture is off on the CUSTOMER account and every payment is in this state.",
      },
    },
  },
  {
    audience: "ADMIN",
    type: "PAYMENT_DISPUTED (on a payment already in a settlement)",
    reconstructed: "services/transactions/handleRazorpayWebhook.js",
    payload: {
      title: "Chargeback on settlement TD/STL/26-27/000123 — ₹810.00",
      body:
        "A dispute landed on a payment already inside settlement TD/STL/26-27/000123. " +
        "That settlement is now on hold for revalidation — rebuild it before approving. " +
        `Evidence must be submitted to Razorpay by ${formatDateTime(new Date("2026-09-07T13:00:00Z"))}.`,
      deepLink: deepLink(ADMIN_PATHS.dispute(REAL.transactionId)),
      mail: {
        lines: [
          ["Amount", "₹810.00"],
          ["Respond by", formatDateTime(new Date("2026-09-07T13:00:00Z"))],
          ["Reason", "product_not_received"],
          ["Invoice", REAL.invoiceId],
          ["Settlement", "TD/STL/26-27/000123"],
        ],
        actions: [
          {
            label: "Open dispute",
            url: adminUrl(ADMIN_PATHS.dispute(REAL.transactionId)),
          },
          {
            label: "Open settlement",
            url: adminUrl(ADMIN_PATHS.settlement(REAL.settlementId)),
          },
        ],
        footnote: "Submit evidence from the Razorpay dashboard before the deadline.",
      },
    },
  },
  {
    audience: "ADMIN",
    type: "PROMO_LIMIT_EXCEEDED (subscription promo)",
    reconstructed: "helpers/subscribeds/settleSubscriptionPayment.js",
    payload: {
      title: "Promo code LAUNCH50 went over its usage limit",
      body: "A payment quoted before the code ran out was settled afterwards, so the discount was honoured. Redemptions are now 101 against a limit of 100.",
      deepLink: deepLink(ADMIN_PATHS.promo("LAUNCH50")),
      mail: {
        lines: [
          ["Promo code", "LAUNCH50"],
          ["Redemptions", "101"],
          ["Limit", "100"],
          ["Transaction", String(REAL.transactionId)],
        ],
        ctaLabel: "Open promo code",
        ctaUrl: adminUrl(ADMIN_PATHS.promo("LAUNCH50")),
        footnote:
          "Nothing to undo — the payment was quoted at that price before the code ran out. Raise the cap or close the code.",
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/** Build every case's payload, in order, with the notice helpers doing the work. */
const buildAll = async () => {
  const built = [];

  for (const testCase of makeCases()) {
    if (!matchesOnly(testCase)) continue;

    if (testCase.payload) {
      built.push({ ...testCase, payload: testCase.payload });
      continue;
    }

    captured = [];
    try {
      await testCase.build();
    } catch (error) {
      built.push({ ...testCase, buildError: error?.message });
      continue;
    }

    if (!captured.length) {
      built.push({ ...testCase, buildError: "the notice did not call notify()" });
      continue;
    }

    // A helper that fans out would capture more than one; take the first and say so.
    built.push({
      ...testCase,
      payload: captured[0],
      extraPayloads: captured.length - 1,
    });
  }

  return built;
};

const pad = (value, width) => String(value ?? "").padEnd(width).slice(0, width);

const report = (built) => {
  console.log("");
  console.log(
    `${pad("#", 4)}${pad("AUDIENCE", 10)}${pad("TYPE", 52)}${pad("BUTTON", 24)}CTA URL / deep link`,
  );
  console.log("-".repeat(140));

  built.forEach((item, index) => {
    const number = `T${String(index + 1).padStart(2, "0")}`;

    if (item.buildError) {
      console.log(
        `${pad(number, 4)}${pad(item.audience, 10)}${pad(item.type, 52)}❌ BUILD FAILED — ${item.buildError}`,
      );
      return;
    }

    const actions = normaliseActions(item.payload.mail || {});
    const button = actions.length
      ? actions.map((a) => a.label).join(" + ")
      : "— none —";

    console.log(
      `${pad(number, 4)}${pad(item.audience, 10)}${pad(item.type, 52)}${pad(button, 24)}${actions[0]?.url || "-"}`,
    );
    console.log(
      `${" ".repeat(66)}deep link: ${item.payload.meta?.deepLink || item.payload.deepLink || "-"}`,
    );
  });

  console.log("-".repeat(140));

  const noButton = built.filter(
    (i) => !i.buildError && !normaliseActions(i.payload.mail || {}).length,
  );
  const noLines = built.filter(
    (i) => !i.buildError && !(i.payload.mail?.lines || []).length,
  );
  const failed = built.filter((i) => i.buildError);

  console.log(`${built.length} case(s)`);
  console.log(`${noButton.length} with no email button`);
  console.log(`${noLines.length} with no detail table`);
  if (failed.length) console.log(`⚠️ ${failed.length} failed to build`);
  console.log("");
  console.log("link targets:");
  for (const [key, source] of Object.entries(REAL.sources)) {
    console.log(`  ${pad(key, 18)} ${source}`);
  }
};

const send = async (built) => {
  console.log("");
  console.log(
    `sending ${built.length} mail(s) to ${RECIPIENTS.length} recipient(s): ${TO}`,
  );
  if (RECIPIENTS.length > 1) {
    console.log(
      "⚠️  one message each, addressed to everyone — reviewers see each other in To:",
    );
  }
  console.log("");

  const results = { sent: 0, skipped: 0, failed: 0 };

  /**
   * Per address, not just per message.
   *
   * ⚠️ One `sendMail` carries every recipient, so a message that "sent" can still
   * have had an address refused — and the only other trace of that is a bounce
   * arriving somewhere else, hours later. `sendMail` reports the transport's
   * `accepted` / `rejected` split; this tallies it so the run can say which
   * person got how many.
   */
  const perRecipient = new Map(
    RECIPIENTS.map((address) => [
      address.toLowerCase(),
      { address, accepted: 0, rejected: 0, unreported: 0 },
    ]),
  );

  const tally = (result) => {
    const accepted = new Set((result.accepted || []).map((a) => a.toLowerCase()));
    const rejected = new Set((result.rejected || []).map((a) => a.toLowerCase()));

    for (const [key, row] of perRecipient) {
      if (accepted.has(key)) row.accepted += 1;
      else if (rejected.has(key)) row.rejected += 1;
      // The transport said nothing either way about this address. Counted rather
      // than assumed — guessing "sent" is how a partial failure disappears.
      else row.unreported += 1;
    }
  };

  for (let index = 0; index < built.length; index += 1) {
    const item = built[index];
    const number = `T${String(index + 1).padStart(2, "0")}`;

    if (item.buildError) {
      console.log(`${number} ❌ not built — ${item.buildError}`);
      results.failed += 1;
      continue;
    }

    const { payload } = item;
    const subject = `[${number} | ${item.audience} | ${item.type}] ${
      payload.mail?.subject || payload.title
    }`;

    /**
     * The same call `notify()` makes, with the review address in place of the
     * resolved recipient — `mail` spread first so nothing is dropped, then the
     * fields `notify` computes.
     */
    const result = await sendMail({
      ...(payload.mail || {}),
      to: TO,
      subject,
      title: payload.mail?.title || payload.title,
      body: payload.mail?.body || payload.body,
    });

    if (result.sent) {
      results.sent += 1;
      tally(result);
      console.log(
        `${number} ✅ ${item.audience.padEnd(8)} ${item.type}` +
          (result.partial ? `  ⚠️ refused: ${result.rejected.join(", ")}` : ""),
      );
    } else if (result.skipped) {
      results.skipped += 1;
      console.log(`${number} ⚪ skipped — ${result.error}`);
    } else {
      results.failed += 1;
      console.log(`${number} ❌ failed — ${result.error}`);
    }

    // Gmail throttles a burst from one account, and a throttled send fails with
    // an error that reads like a credential problem.
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  console.log("");
  console.log(
    `messages: sent ${results.sent} · skipped ${results.skipped} · failed ${results.failed}`,
  );

  console.log("");
  console.log(
    `${pad("RECIPIENT", 40)}${pad("ACCEPTED", 10)}${pad("REFUSED", 10)}NOT REPORTED`,
  );
  console.log("-".repeat(72));
  for (const row of perRecipient.values()) {
    console.log(
      `${pad(row.address, 40)}${pad(row.accepted, 10)}${pad(row.rejected, 10)}${row.unreported}`,
    );
  }
  console.log("-".repeat(72));
  console.log(
    "⚠️  'accepted' means the outgoing server took it for delivery — not that it reached the inbox. A mailbox that does not exist bounces afterwards.",
  );
};

const main = async () => {
  if (!RECIPIENTS.length) {
    console.error(
      "--to=<email>[,<email>…] is required. Nothing is sent without it, and there is no default.",
    );
    process.exit(1);
  }

  const malformed = RECIPIENTS.filter((a) => !LOOKS_LIKE_EMAIL.test(a));
  if (malformed.length) {
    console.error(`not an email address: ${malformed.join(", ")}`);
    process.exit(1);
  }

  if (!process.env.MONGO_URL) {
    console.error("MONGO_URL is not set — link targets cannot be resolved.");
    process.exit(1);
  }

  /**
   * ⚠️ Read-only, and `autoIndex: false`: requiring a model on a live database
   * otherwise lets Mongoose check and build indexes, which a review script must
   * never do. The connection exists for two reasons only — to borrow real ids for
   * the buttons, and so `resolveBrandIdentity`'s GST lookup returns instead of
   * buffering for ten seconds per brand notice.
   */
  await mongoose.connect(process.env.MONGO_URL, { autoIndex: false });
  console.log(`database : ${mongoose.connection.name} (read-only)`);

  await loadRealTargets();

  const built = await buildAll();
  report(built);

  if (!APPLY) {
    console.log("");
    console.log(
      `🔍 Dry run — nothing sent. Re-run with --apply to mail all ${built.length} to ${RECIPIENTS.length} recipient(s): ${TO}`,
    );
  } else {
    await send(built);
  }

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error("failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
