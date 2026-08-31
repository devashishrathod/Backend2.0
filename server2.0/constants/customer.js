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
 * Off until the customer checkout ships. While off, passing a promo code is
 * rejected outright rather than silently ignored — charging full price on a
 * code the customer believes they applied is not acceptable.
 */
const CUSTOMER_PROMO_DEFAULTS = Object.freeze({
  isEnabled: false,
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
    percent: 5,
    holdDays: 30,
    riskChargebackCount: 2,
  }),
  // A brand's first few days, when there is no history to judge risk by.
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
});

/**
 * Chargebacks.
 */
const CHARGEBACK_DEFAULTS = Object.freeze({
  // After this an unresolved chargeback is written off by an admin rather than
  // held open forever.
  writeOffDays: 90,
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
  SETTLEMENT_CYCLE_TYPES,
  PAYOUT_PROVIDERS,
  REFUND_METHODS,
  VENDOR_TIMEOUT_ACTIONS,
};
