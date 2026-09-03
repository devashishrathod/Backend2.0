/**
 * Transaction enums — the money ledger's shared vocabulary.
 *
 * One `Transaction` collection serves two very different flows: vendor
 * subscription purchases and customer voucher claims. `purpose` is what keeps
 * them apart, and `gatewayAccount` is what keeps their two Razorpay accounts
 * apart. Both are required on every row, and every query goes through
 * `helpers/transactions/buildTransactionFilter.js` so neither can be forgotten.
 *
 * See docs/customer_voucher_claim_plan.md §2 and §3.
 */

/**
 * The two Razorpay accounts. They are entirely separate merchants — different
 * key id, different secret, different webhook secret, different settlement bank
 * cycle.
 *
 * This is stored on the transaction rather than derived at call time, because
 * "which secret verifies this payment" must be a *fact about the row*, not a
 * convention each caller remembers. Hardcoding `ROLES.VENDOR` at a call site is
 * exactly how a payment ends up unverifiable with the money already captured.
 */
const RAZORPAY_ACCOUNTS = Object.freeze({
  VENDOR: "VENDOR",
  CUSTOMER: "CUSTOMER",
});

/**
 * What the money was for. Drives the settlement router in
 * `handleRazorpayWebhook` and the partial filter on every purpose-scoped index,
 * so a subscription insert never touches a voucher index and vice versa.
 */
const TRANSACTION_PURPOSE = Object.freeze({
  SUBSCRIPTION: "SUBSCRIPTION",
  VOUCHER_CLAIM: "VOUCHER_CLAIM",
});

/**
 * The account a purpose defaults to. Only a default — `gatewayAccount` is
 * written explicitly on every row so a third account (or a purpose that moves
 * between accounts) does not require a model change.
 */
const ACCOUNT_FOR_PURPOSE = Object.freeze({
  [TRANSACTION_PURPOSE.SUBSCRIPTION]: RAZORPAY_ACCOUNTS.VENDOR,
  [TRANSACTION_PURPOSE.VOUCHER_CLAIM]: RAZORPAY_ACCOUNTS.CUSTOMER,
});

/**
 * How far settlement got.
 *
 * The conditional claim (`verified: false -> true`) is terminal: once it wins,
 * no retry, replay or webhook can re-enter. But six dependent writes happen
 * *after* it — claim, usage, promo commit, ledger, invoice, notify. A crash in
 * between used to leave the row permanently half-settled with money captured
 * and nothing to show for it.
 *
 * Every stage is idempotent, so `resumeIncompleteSettlements` does not need to
 * know where it stopped — it re-runs the lot and the finished work no-ops.
 */
const SETTLEMENT_STAGE = Object.freeze({
  // Conditional claim won; the payment is ours to settle.
  CLAIMED: "CLAIMED",
  // Domain records written: claim status, usage, promo commit, ledger entries.
  RECORDED: "RECORDED",
  // Invoice number allotted and snapshot frozen. The PDF itself is lazy.
  INVOICED: "INVOICED",
  // Notifications dispatched. Nothing left to resume.
  COMPLETE: "COMPLETE",
});

/**
 * Who absorbs Razorpay's MDR.
 *
 * Razorpay settles **net** — it deducts MDR plus GST on that MDR before the
 * money reaches our bank. UPI and RuPay debit are zero-MDR by RBI mandate;
 * credit cards are around 2%. Until this was modelled the platform was quietly
 * absorbing it with nothing recorded anywhere.
 *
 * PLATFORM is the current policy. The other two exist so switching is a config
 * change rather than a schema migration — see vendor_settlement_plan.md §12.4.
 */
const GATEWAY_FEE_BEARER = Object.freeze({
  PLATFORM: "PLATFORM",
  VENDOR: "VENDOR",
  SHARED: "SHARED",
});

/**
 * Invoice / statement number series. Each gets its own `Counter` document per
 * financial year, so the numbers stay monotonic within a series — which is what
 * GST expects of a document-of-record sequence.
 *
 *   INVOICE:VCH:25-26  ->  TD/VCH/25-26/000001
 */
const INVOICE_SERIES = Object.freeze({
  [TRANSACTION_PURPOSE.SUBSCRIPTION]: "SUB",
  [TRANSACTION_PURPOSE.VOUCHER_CLAIM]: "VCH",
  SETTLEMENT: "STL",
});

/**
 * Index names, declared once.
 *
 * `razorpayOrderId` and `invoiceId` were plain `unique: true` paths, which
 * Mongo names `razorpayOrderId_1` / `invoiceId_1`. They are being replaced by
 * partial-unique indexes because a voucher-claim row is inserted *without* an
 * invoice number, and in a non-sparse unique index a missing field is stored as
 * `null` — so the second such row would collide.
 *
 * The replacements carry explicit distinct names so the migration can create
 * the new index, verify it, and only then drop the old one by name. Sharing a
 * name would make that impossible, and simply editing the schema would raise
 * IndexOptionsConflict (code 85) — which Mongoose swallows on the `index`
 * event, leaving whichever index happened to win.
 */
const TRANSACTION_INDEXES = Object.freeze({
  INVOICE_ID: "invoiceId_unique_partial",
  RAZORPAY_ORDER_ID: "razorpayOrderId_unique_partial",
  INVOICE_TOKEN: "invoiceToken_unique_partial",
  IDEMPOTENCY_KEY: "customer_idempotencyKey_unique_partial",
  VOUCHER_CLAIM_ID: "voucherClaimId_unique_partial",
});

/** The legacy index names the migration drops. */
const LEGACY_TRANSACTION_INDEXES = Object.freeze({
  INVOICE_ID: "invoiceId_1",
  RAZORPAY_ORDER_ID: "razorpayOrderId_1",
});

/**
 * Which document an invoice snapshot describes, and the renderer's branch key.
 *
 * The two layouts share a header and a total and nothing else. A subscription
 * invoice prints a plan name, a duration and a validity range; a voucher claim
 * has none of those and instead has a bill, an offer, an outlet and a claim
 * code. Running one through the other's layout produces a document with empty
 * fields and `Validity: - to -` where a date belongs.
 */
const INVOICE_KIND = Object.freeze({
  SUBSCRIPTION: "SUBSCRIPTION",
  VOUCHER_CLAIM: "VOUCHER_CLAIM",
});

/**
 * What the document calls itself.
 *
 * ⚠️ "TAX INVOICE" on a document carrying no tax is wrong. Customer GST is off
 * by default, so a claim prints **PAYMENT RECEIPT** until it is switched on.
 */
const INVOICE_TITLE = Object.freeze({
  TAX_INVOICE: "TAX INVOICE",
  RECEIPT: "PAYMENT RECEIPT",
});

/**
 * The one colour an admin dashboard paints the money page.
 *
 * Derived at read time, never stored — a stored health status is a number that
 * stops updating, which reads as "zero problems" while the problem grows.
 *
 * `CRITICAL` is reserved for what **loses money on a timer**: an uncaptured
 * authorization refunds itself in about five days, a missed dispute deadline
 * forfeits by default. `ATTENTION` is real but it waits for a human without
 * getting worse. Collapsing the two would train people to ignore the red.
 */
const PAYMENT_HEALTH_STATUS = Object.freeze({
  OK: "OK",
  ATTENTION: "ATTENTION",
  CRITICAL: "CRITICAL",
});

module.exports = {
  PAYMENT_HEALTH_STATUS,
  INVOICE_KIND,
  INVOICE_TITLE,
  RAZORPAY_ACCOUNTS,
  TRANSACTION_PURPOSE,
  ACCOUNT_FOR_PURPOSE,
  SETTLEMENT_STAGE,
  GATEWAY_FEE_BEARER,
  INVOICE_SERIES,
  TRANSACTION_INDEXES,
  LEGACY_TRANSACTION_INDEXES,
};
