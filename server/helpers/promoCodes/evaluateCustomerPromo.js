const {
  PROMO_REJECTION,
  PROMO_APPLIES_TO,
} = require("../../constants/promoCode");
const { assertPromoWindowAndCaps } = require("./assertPromoWindowAndCaps");
const { round2 } = require("../subscribeds/calculatePricing");

const sameId = (a, b) => String(a) === String(b);

/**
 * Does this code appear in a scope list at all?
 *
 * An empty list means "no restriction", which is not the same as "matches
 * nothing" — getting that backwards makes every unscoped code stop working.
 */
const inScope = (list, id) =>
  !list?.length || list.some((entry) => sameId(entry, id));

/**
 * The two gates that need the bill itself.
 *
 * ⚠️ The minimum is compared against the **raw** bill, not against the base the
 * discount comes off. A customer reading "minimum order ₹300" means the number
 * they typed; telling them a ₹320 bill is too small because the voucher offer
 * already took it to ₹280 is indefensible, and it would make the minimum depend
 * on which offer happened to apply.
 *
 * @returns {string|null} the rejection, or null
 */
const billRejectionFor = (
  promo,
  { offerApplied, allowWhenNoOffer, billAmount },
) => {
  // A promo on top of no offer at all is a pure giveaway with no vendor supply
  // behind it, so it is off unless an admin turned it on.
  if (!offerApplied && !allowWhenNoOffer) {
    return PROMO_REJECTION.NO_OFFER_APPLIED;
  }
  if (promo.minBillAmount && round2(billAmount) < promo.minBillAmount) {
    return PROMO_REJECTION.MIN_BILL_AMOUNT;
  }
  return null;
};

/**
 * The three scope lists, in the order a customer should hear about them.
 *
 * Split out of the main sequence only to keep that sequence readable — it is
 * still one gate, and it still runs in place.
 *
 * @returns {string|null} the rejection, or null when the code is in scope
 */
const scopeRejection = (promo, voucher, brandId) => {
  if (!inScope(promo.voucherIds, voucher?._id)) {
    return PROMO_REJECTION.VOUCHER_NOT_ELIGIBLE;
  }
  if (!inScope(promo.brandIds, brandId)) {
    return PROMO_REJECTION.BRAND_NOT_ELIGIBLE;
  }
  // A voucher carries both a category and a sub-category; either matching is
  // enough, because an admin scoping by "Food" means the one the customer would
  // recognise.
  if (promo.categoryIds?.length) {
    const matched =
      inScope(promo.categoryIds, voucher?.categoryId) ||
      (voucher?.subCategoryId &&
        promo.categoryIds.some((id) => sameId(id, voucher.subCategoryId)));
    if (!matched) return PROMO_REJECTION.CATEGORY_NOT_ELIGIBLE;
  }
  return null;
};

/**
 * Decide a **customer** promo code against one checkout, without touching the
 * database.
 *
 * ### Why this is separate from `validateCustomerPromoCode`
 *
 * Two callers ask the same question and must never answer it differently:
 *
 *  - **checkout** (`validateCustomerPromoCode`) resolves one typed code;
 *  - **the listing** (`services/promoCodes/getCustomerPromoCodes.js`) decides a
 *    whole page of codes at once, for the drawer the customer picks from.
 *
 * If the listing had its own copy of these rules, the day one of them changed
 * the app would offer a code it cannot apply — and the customer would only find
 * out after tapping Apply. So the rules live here, once, and both callers feed
 * this the same shape.
 *
 * ### The counts are inputs, not lookups
 *
 * `priorOrderCount` and `customerUsageCount` are the only two gates that need a
 * query, and they are passed in. That is what lets the listing count **one page
 * of codes in one aggregation** instead of two queries per row, while checkout
 * still fetches them one code at a time. Each caller also skips the query it
 * does not need: `firstOrderOnly` and `perCustomerUsageLimit` are readable off
 * the document before deciding to count anything.
 *
 * ⚠️ Both default to `0`, which reads as "nothing used yet". A caller that
 * forgets to count therefore gets the **permissive** answer. That is the wrong
 * direction to fail in, so every caller is expected to pass them — the money
 * suite pins both gates for exactly this reason.
 *
 * ### `hasCheckoutContext: false`
 *
 * The listing is also opened with no checkout behind it — a customer browsing
 * their coupons rather than standing at a bill. Half these gates simply cannot
 * be answered there: there is no bill to compare a minimum against, no voucher
 * to check a scope against, and no base to price a discount from.
 *
 * So that case is a **mode**, not a set of stand-in values. Passing a bill of
 * zero would reject every code with a minimum; passing `offerApplied: true`
 * would claim an offer that does not exist. Both are lies that read as answers.
 * In this mode the checkout-dependent gates are skipped, `discount` comes back
 * `null` rather than `0` — "not priced", not "worth nothing" — and the gates
 * that stand on their own (the window, the platform cap, the per-customer cap,
 * first-order-only) still decide.
 *
 * ### Order matters
 *
 * The sequence below is the order a customer should hear about problems, and it
 * is the order checkout has always used. The minimum bill is checked against
 * the **raw** bill before anything else, because "minimum order ₹300" means the
 * number they typed — telling them a ₹320 bill is too small because the voucher
 * offer already took it to ₹280 is indefensible.
 *
 * @param {object}  args
 * @param {object}  args.promo             the PromoCode document
 * @param {object}  [args.voucher]         { _id, categoryId, subCategoryId }
 * @param {object}  [args.brandId]         the brand the claim is against
 * @param {number}  [args.billAmount]      the raw bill, before any offer
 * @param {number}  [args.netBill]         bill minus the offer discount
 * @param {number}  [args.convenienceFee]
 * @param {object}  [args.config]          `getCustomerConfig().promoCode`
 * @param {boolean} [args.offerApplied]    whether a voucher offer is in play
 * @param {boolean} [args.isGuest]         no identity — per-customer gates skipped
 * @param {number}  [args.priorOrderCount] settled claims this customer already has
 * @param {number}  [args.customerUsageCount] RESERVED + CONSUMED rows they hold
 * @param {boolean} [args.hasCheckoutContext] false when there is no bill behind
 *        the question — see above
 * @returns {{ok: boolean, reason?: string, promoCode?: object, discount?: number,
 *            provisional?: boolean, appliesTo?: string, promoBase?: number}}
 */
exports.evaluateCustomerPromo = ({
  promo,
  voucher,
  brandId,
  billAmount = 0,
  netBill = 0,
  convenienceFee = 0,
  config = {},
  offerApplied = false,
  isGuest = false,
  priorOrderCount = 0,
  customerUsageCount = 0,
  hasCheckoutContext = true,
}) => {
  if (!promo) return { ok: false, reason: PROMO_REJECTION.NOT_FOUND };

  const reject = (reason) => ({ ok: false, reason, promoCode: promo });

  // ---------- what the discount comes off ----------
  const appliesTo = promo.appliesTo || PROMO_APPLIES_TO.NET_BILL;
  const resolveBase = () => {
    if (!hasCheckoutContext) return 0;
    return appliesTo === PROMO_APPLIES_TO.CONVENIENCE_FEE
      ? round2(convenienceFee || 0)
      : round2(netBill || 0);
  };
  const base = resolveBase();

  /**
   * Nothing priced without a checkout: `discount: null` says "not priced here",
   * where `0` would say "worth nothing" and send the app to a strikethrough.
   */
  const priced = (verdict, extra = {}) =>
    hasCheckoutContext
      ? { ...verdict, appliesTo, promoBase: base, ...extra }
      : { ...verdict, discount: null, appliesTo, promoBase: null, ...extra };

  if (hasCheckoutContext) {
    const billRejection = billRejectionFor(promo, {
      offerApplied,
      allowWhenNoOffer: config.allowWhenNoOffer,
      billAmount,
    });
    if (billRejection) return reject(billRejection);
  }

  // ---------- shared gates: live, in window, platform cap, worth ----------
  const verdict = assertPromoWindowAndCaps({ promo, base });
  if (!verdict.ok) return verdict;

  // ---------- customer-specific scope ----------
  if (hasCheckoutContext) {
    const outOfScope = scopeRejection(promo, voucher, brandId);
    if (outOfScope) return reject(outOfScope);
  }

  // ---------- per-customer rules ----------
  //
  // A guest cannot be checked against either. The verdict is marked provisional
  // and the caller re-validates once they sign in.
  if (isGuest) return priced(verdict, { provisional: true });

  if (promo.firstOrderOnly && priorOrderCount > 0) {
    return reject(PROMO_REJECTION.FIRST_ORDER_ONLY);
  }

  if (customerUsageCount >= (promo.perCustomerUsageLimit ?? 1)) {
    return reject(PROMO_REJECTION.CUSTOMER_LIMIT_REACHED);
  }

  return priced(verdict, { provisional: false });
};
