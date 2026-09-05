/**
 * Customer-side platform constants.
 *
 * Everything here is a **fallback only**. The live values come from
 * `Setting.customer` via `helpers/settings/getCustomerConfig.js`, so an admin can
 * always override them without a deploy. Nothing should read these directly —
 * go through the helper.
 *
 * The seller's legal identity (company name, GSTIN, address, state) is
 * deliberately **not** here: there is one legal entity, and it lives in
 * `Setting.vendor.subscription.company*`. Duplicating it would let an invoice
 * for a voucher claim disagree with an invoice for a subscription.
 */

/**
 * Convenience fee slabs.
 *
 * Every `slabSize` rupees of the bill costs `feePerSlab`:
 *
 * |        Bill | Fee |
 * |------------:|----:|
 * |     1 –  500 |  5 |
 * |   501 – 1000 | 10 |
 * |  1001 – 1500 | 15 |
 * |  1501 – 2000 | 20 |
 *
 * `ceil(bill / slabSize) * feePerSlab`, capped at `maxFee`.
 *
 * The fee is computed on the **original bill**, not on what is left after the
 * discount. Basing it on the discounted figure would make the fee move every
 * time a different offer applied, which reads as arbitrary to the customer and
 * would force a separate fee on every row of an offer comparison.
 *
 * ⚠️ `maxFee` used to default to `null`, which meant no ceiling at all — a
 * ₹10,000 bill would have carried a ₹100 convenience fee. The default is now
 * **50**. `null` is still accepted and still means "no ceiling", but it now has
 * to be chosen deliberately rather than arrived at by never touching the
 * setting.
 */
const CONVENIENCE_FEE_DEFAULTS = Object.freeze({
  isEnabled: true,
  slabSize: 500,
  feePerSlab: 5,
  maxFee: 50,
  // When no offer applies, the customer is paying their bill with no discount.
  // Charging a platform fee on top of that means they pay MORE than they would
  // have without Trydood, so it is off by default.
  chargeWhenNoOffer: false,
});

/**
 * GST on the convenience fee.
 *
 * Off by default, and deliberately so: the fee is Trydood's own service income,
 * and whether it attracts GST depends on registration and turnover thresholds
 * that are a finance decision, not a technical one. Turning it on mid-campaign
 * changes what customers pay, so it is an explicit admin action.
 *
 * `isGstInclusive: true` means the slab amounts above are what the customer
 * pays in total and the tax is back-calculated out of them — so switching the
 * master switch on does not silently raise the price.
 */
const CUSTOMER_TAX_DEFAULTS = Object.freeze({
  isGstEnabled: false,
  gstPercentage: 18,
  isGstInclusive: true,
  // Services not elsewhere classified — the SAC for a platform facilitation fee.
  sacCode: "998599",
});

/**
 * Customer-side promo codes.
 *
 * On by default. Passing a promo code while this is off is rejected outright
 * rather than silently ignored — charging full price on a code the customer
 * believes they applied is not acceptable, and that stays true whichever way
 * the default points.
 *
 * ⚠️ `allowWhenNoOffer` below stays **off**. That is a separate decision and a
 * more expensive one: a promo on top of no vendor offer at all is a pure
 * giveaway with no supply behind it, so it is turned on deliberately per
 * platform rather than inherited from this flag.
 */
const CUSTOMER_PROMO_DEFAULTS = Object.freeze({
  isEnabled: true,
  // A promo on top of no offer at all is a pure giveaway with no vendor supply
  // behind it, so it needs to be turned on deliberately.
  allowWhenNoOffer: false,
  // A guest has no identity, so per-customer caps and first-order checks cannot
  // be evaluated. The preview shows the discount as provisional and it is
  // re-validated at order creation, once they have logged in.
  allowForGuestPreview: true,
});

/**
 * The claim flow itself.
 */
const CLAIM_DEFAULTS = Object.freeze({
  // Kill switch. Everything customer-facing reads this before quoting a price.
  isEnabled: true,
  // A customer can still pay their bill through Trydood when no offer matches —
  // they just get no discount. The convenience fee is separately gated by
  // `convenienceFee.chargeWhenNoOffer`, which is false, so this costs them
  // nothing extra.
  allowWhenNoOffer: true,
  // Not a business limit — a guard against a typo or a hostile client turning
  // one claim into a six-figure transaction.
  maxBillAmount: 100000,
  // An open unpaid order is handed back rather than duplicated, so a customer
  // tapping Pay twice does not end up with two Razorpay orders.
  pendingOrderReuseMinutes: 10,
  // How long a quoted price stays honourable. Matches the promo reservation TTL
  // on purpose: a quote outliving its reservation would promise a discount the
  // ledger had already released.
  quoteTtlMinutes: 30,
  // A brand whose subscription has lapsed is not selling through Trydood. Off,
  // because taking a customer's money for a vendor we are no longer serving is
  // the wrong default.
  allowWhenVendorPlanExpired: false,
  // Grace for a plan that lapsed hours ago and is about to be renewed. 0 means
  // no grace at all.
  vendorPlanExpiredGraceDays: 0,
  // Phase 2, when a claim becomes a two-step redeem-at-the-counter flow. Inert
  // today because payment is final on the spot.
  redemptionWindowHours: 24,
});

/**
 * Which channels a customer hears from.
 *
 * The in-app notification row is always written; these govern outbound delivery
 * only. WhatsApp is off until the Meta-approved templates exist — even when on,
 * a message type with no approved template still does not send.
 */
const CUSTOMER_NOTIFICATION_DEFAULTS = Object.freeze({
  isEmailNotificationEnabled: true,
  isPushNotificationEnabled: true,
  isWhatsAppNotificationEnabled: false,
});

/**
 * Invoice numbering.
 *
 * `TD/VCH/25-26/000123`. The series is per financial year and the counter is
 * atomic, so the sequence has no gaps and no duplicates.
 *
 * ⚠️ Changing `seriesPrefix` starts a **new** counter. Numbers already issued
 * keep the old prefix, which is correct — an invoice number is a permanent
 * legal reference and is never rewritten.
 */
const CUSTOMER_INVOICE_DEFAULTS = Object.freeze({
  seriesPrefix: "VCH",
});

/**
 * Paying the vendor out.
 *
 * `delayDays` is the T+N that the whole refund design rests on — see
 * `REFUND_DEFAULTS` and `assertSettlementTimingRule`.
 */
const SETTLEMENT_DEFAULTS = Object.freeze({
  isEnabled: true,
  // T+3. Razorpay holds funds for T+2 of its own accord, so anything shorter
  // was never achievable anyway.
  delayDays: 3,
  // Extra buffer after the money actually lands in Trydood's bank, on top of
  // the T+N floor. Both must be satisfied.
  payoutBufferHours: 6,
  cycleType: "DAILY",
  // Every payout is eyeballed before it leaves. Turning this off auto-approves.
  requiresAdminApproval: true,
  // Below this the day is carried forward rather than paid — a ₹12 NEFT costs
  // more in effort than it moves.
  minPayoutAmount: 100,
  // Manual NEFT today. RazorpayX / Route change this value, not the flow.
  payoutProvider: "MANUAL_BANK",
  // Structure is in place and every number flows through it; the rate is zero
  // until commercials say otherwise.
  commissionPercent: 0,
  // Withholding a slice of a risky vendor's payout against future chargebacks.
  // Off for everyone; turned on per-vendor once the risk signals exist.
  reserve: Object.freeze({
    isEnabled: false,
    /** The base rate. Every brand with nothing against them pays this. */
    percent: 5,
    holdDays: 30,
    /**
     * ⚠️ How many chargebacks in the window before we look at all.
     *
     * A **trigger**, not the whole test. On its own a count punishes size: a
     * brand doing 10,000 sales with 2 chargebacks is safer than one doing 40
     * with 2, and holding more from the first is holding more from the better
     * merchant. `riskDisputeRatePercent` is the other half.
     */
    riskChargebackCount: 2,
    /** How far back the count and the rate are measured. */
    riskLookbackDays: 180,
    /**
     * ⚠️ The floor under the rate.
     *
     * One chargeback out of three sales is 33% and means nothing — the sample is
     * too small to carry an opinion. Below this many payments the brand keeps
     * the base rate, however the arithmetic looks. Without it, a single unlucky
     * week freezes a new outlet's money on their first month.
     */
    riskMinPayments: 20,
    /** Chargebacks ÷ payments, as a percentage, above which a brand is risky. */
    riskDisputeRatePercent: 1,
    /** What a risky brand holds instead of `percent`. */
    riskPercent: 15,
    /**
     * ⚠️ The ceiling, and it is a business decision rather than an arithmetic
     * one. Without it a bad month could hold back nearly everything and cut a
     * vendor off from their own cash flow — which is how a recoverable problem
     * becomes a closed outlet.
     */
    maxPercent: 25,
  }),
  /**
   * A brand's first few days, when there is no history to judge risk by.
   *
   * ⚠️ Unproven means **more** held, not less — the same reading acquirers take
   * of a new merchant. A brand whose first payment is newer than this holds
   * `reserve.riskPercent`. `0` (today) switches it off entirely.
   */
  newVendorReserveDays: 0,
  // How long a settlement may sit un-received before it is treated as a
  // problem worth waking someone for.
  notReceivedAlertHours: 96,
  // Who absorbs the Razorpay MDR. PLATFORM is today's behaviour — the change
  // here is that it is now visible and recorded rather than implicit.
  gatewayFeeBearer: "PLATFORM",
});

/**
 * Refunds.
 *
 * ### The golden rule
 *
 * ```
 * delayDays * 24  >=  windowHours + vendorApprovalHours + adminBufferHours
 * ```
 *
 * Default: 72h ≥ 24 + 24 + 12 = 60h ✓
 *
 * While that holds, **a refund can never touch money that has already gone to
 * the vendor.** A refund simply reduces that cycle's payable. Break it and the
 * platform is left recovering money from a vendor who has already banked it —
 * which means negative balances, awkward conversations, and a reconciliation
 * problem that only shows up weeks later.
 *
 * That is why it is a **422 on save**, not advice in a comment. It is checked in
 * `assertSettlementTimingRule` against the *merged* config, because a PATCH that
 * only raises `windowHours` would otherwise never see `delayDays`.
 */
const REFUND_DEFAULTS = Object.freeze({
  // Back to the card / UPI the customer paid with. MANUAL_BANK is the fallback
  // when that instrument is dead.
  method: "SOURCE",
  // How long after paying a customer may raise a refund.
  windowHours: 24,
  // The vendor's window to accept or reject. A silent vendor cannot hold a
  // customer's money indefinitely — after this it escalates.
  vendorApprovalHours: 24,
  // Admin's own window to execute once it reaches them.
  adminBufferHours: 12,
  // ESCALATE | AUTO_APPROVE. Escalating keeps a human in the loop.
  onVendorTimeout: "ESCALATE",
  allowPartial: true,
  // A refunded claim does NOT hand the promo code use back. The campaign budget
  // was spent, and returning the slot would let a single-use code be recycled by
  // claiming and refunding.
  releasePromoOnRefund: false,
  // A payment stuck in `authorized` without capture is money neither party has.
  // Alert rather than wait.
  authorizedAlertMinutes: 30,

  /**
   * When a `MANUAL_BANK` refund is waiting on the customer for bank details.
   *
   * Hours after the ask at which they are reminded. ⚠️ Days apart, not hours:
   * the first message went out with the refund failure and this is a nudge, not
   * a chase. Someone who has already been told their refund failed and is then
   * pinged hourly for their account number reads it as a scam, and the money
   * they are owed becomes the thing they least want to engage with.
   */
  bankDetailsReminderHours: [24, 96],

  /**
   * After this, a silent customer becomes an admin's problem.
   *
   * ⚠️ Not a deadline for the customer — their money stays theirs, and the
   * refund stays open. It is a deadline for **the vendor's**: a hold nobody
   * releases keeps their money out of every future settlement for ever, and one
   * customer who never answers should not cost a vendor indefinitely.
   *
   * At that point an admin can release the hold with a written reason. The
   * refund is still owed, and `claimRefundAdjustments` recovers it from a later
   * cycle if the customer ever does answer — so nothing is written off, only
   * un-frozen.
   */
  bankDetailsStaleDays: 30,

  /**
   * ---------- abuse limits ----------
   *
   * ⚠️ These count **refused** requests, never approved ones.
   *
   * The signal that something is wrong is not how much money went back — it is
   * *"the vendor looked at this and said it was not legitimate"*. A customer with
   * five approved refunds had five genuinely bad experiences, and blocking their
   * sixth punishes exactly the person the process exists for. Worse, the
   * customers of the worst brand hit a raw request cap first, and they are the
   * ones most entitled to ask.
   */

  /**
   * How many refunds one customer may have in flight **across all their
   * claims**.
   *
   * Different from the unique index on `RefundRequest`, which allows one open
   * request per *payment*. This one stops somebody opening a request against
   * every claim they have ever made and burying the vendor.
   */
  maxOpenRequests: 1,

  /**
   * Refused or withdrawn requests allowed in the rolling window.
   *
   * `CANCELLED` counts alongside the rejections, and deliberately: raise →
   * vendor sees it → withdraw → raise again is a way to keep a vendor busy
   * without ever collecting a rejection. Withdrawing once is nothing; doing it
   * five times is the pattern this is here for.
   */
  maxRejectedPerWindow: 3,
  requestWindowDays: 30,
});

/**
 * Chargebacks.
 */
const CHARGEBACK_DEFAULTS = Object.freeze({
  // After this an unresolved chargeback is written off by an admin rather than
  // held open forever.
  writeOffDays: 90,
  /**
   * Hours before `disputeRespondBy` at which an admin is warned — widest first.
   *
   * ⚠️ A dispute deadline that passes is an **automatic loss**. The bank does
   * not chase us, Razorpay does not chase us, and the money simply goes. The
   * field was already being filled from the webhook and nothing was reading it,
   * so the only way to see a deadline was for somebody to open the worklist and
   * check the dates by eye — one holiday or one busy week and it was gone, with
   * no error and no alert anywhere.
   *
   * Two stages rather than one: a single warning that lands during a weekend is
   * the same as no warning, and the escalation to CRITICAL is what distinguishes
   * "look at this soon" from "today".
   */
  deadlineAlertHours: [72, 24],
});

/**
 * Money formatting for customer-facing text.
 *
 * The subscription side reads these off `getSubscriptionConfig()`, which is the
 * **vendor** config. A customer-facing string must not depend on vendor
 * settings, and the alternative — hardcoding "₹" at the call site — is on the
 * Never list.
 */
const CUSTOMER_CURRENCY_DEFAULTS = Object.freeze({
  currency: "INR",
  currencySymbol: "₹",
});

/** Enumerations an admin may pick from. Frozen; the validator reads these. */
const SETTLEMENT_CYCLE_TYPES = Object.freeze({
  DAILY: "DAILY",
  WEEKLY: "WEEKLY",
});

const PAYOUT_PROVIDERS = Object.freeze({
  MANUAL_BANK: "MANUAL_BANK",
  RAZORPAY_X: "RAZORPAY_X",
  RAZORPAY_ROUTE: "RAZORPAY_ROUTE",
});

const REFUND_METHODS = Object.freeze({
  SOURCE: "SOURCE",
  MANUAL_BANK: "MANUAL_BANK",
});

/**
 * The OTP purpose for attaching a bank account to a customer.
 *
 * ⚠️ Its own purpose, never `"auth"`. `verifyOtp` scopes and consumes a code by
 * `(target, purpose)`, so sharing the login purpose would let a code sent for
 * signing in be spent on redirecting a refund — and the customer would see a
 * perfectly ordinary login OTP arrive just before their money went elsewhere.
 */
const BANK_ATTACH_OTP_PURPOSE = "customer-bank-attach";

/**
 * The customer home screen's search box.
 *
 * `minQueryLength` is the one that changes behaviour rather than volume: below
 * it the API refuses the query outright, so the app knows exactly when it may
 * start calling. One character against every brand, voucher and area on the
 * platform is a scan that returns almost everything and helps nobody.
 *
 * `popularQueries` is curated by an admin, not derived from traffic — nothing
 * logs what customers search for. Empty is a valid state and simply means the
 * app shows no chips.
 */
const CUSTOMER_SEARCH_DEFAULTS = Object.freeze({
  isEnabled: true,
  minQueryLength: 2,
  // Rows per section in overview mode.
  sectionLimit: 5,
  // How many recent searches one customer keeps.
  historyLimit: 20,
  popularQueries: Object.freeze([]),
});

const VENDOR_TIMEOUT_ACTIONS = Object.freeze({
  ESCALATE: "ESCALATE",
  AUTO_APPROVE: "AUTO_APPROVE",
});

module.exports = {
  CONVENIENCE_FEE_DEFAULTS,
  CUSTOMER_TAX_DEFAULTS,
  CUSTOMER_PROMO_DEFAULTS,
  CLAIM_DEFAULTS,
  CUSTOMER_NOTIFICATION_DEFAULTS,
  CUSTOMER_INVOICE_DEFAULTS,
  SETTLEMENT_DEFAULTS,
  REFUND_DEFAULTS,
  CHARGEBACK_DEFAULTS,
  CUSTOMER_CURRENCY_DEFAULTS,
  CUSTOMER_SEARCH_DEFAULTS,
  SETTLEMENT_CYCLE_TYPES,
  PAYOUT_PROVIDERS,
  REFUND_METHODS,
  BANK_ATTACH_OTP_PURPOSE,
  VENDOR_TIMEOUT_ACTIONS,
};
