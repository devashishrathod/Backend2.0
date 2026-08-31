const PromoCode = require("../../models/PromoCode");
const PromoCodeUsage = require("../../models/PromoCodeUsage");
const Transaction = require("../../models/Transaction");
const {
  PROMO_USAGE_STATUS,
  PROMO_REJECTION,
  PROMO_AUDIENCE,
  PROMO_APPLIES_TO,
  PROMO_COST_BEARING_MODE,
} = require("../../constants/promoCode");
const { assertPromoWindowAndCaps } = require("./assertPromoWindowAndCaps");
const { buildAudienceFilter } = require("./buildAudienceFilter");
const { round2 } = require("../subscribeds/calculatePricing");
const { buildTransactionFilter } = require("../transactions/buildTransactionFilter");
const { TRANSACTION_PURPOSE } = require("../../constants/transaction");

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
 * Resolve a **customer voucher-claim** promo code and compute what it is worth.
 *
 * The vendor twin is `validatePromoCode`. The two share every audience-agnostic
 * rule through `assertPromoWindowAndCaps` — the window, the platform-wide cap,
 * and the discount arithmetic — so they can never disagree on what a code is
 * worth. Only the scope checks differ, and they are here.
 *
 * Returns a verdict rather than throwing, so the preview endpoint can render a
 * disabled Apply button with a reason while order creation turns the same
 * verdict into a 422. Silently charging full price on a code the customer
 * believes they applied is not acceptable.
 *
 * ### The base matters
 *
 * `appliesTo` decides what the discount comes off — the bill after the voucher
 * offer, or Trydood's convenience fee. The discount is then clamped to **that
 * base**, never to the order total: a ₹50 code against a ₹10 fee is worth ₹10,
 * and letting it exceed the base would eat into something it was never meant to
 * discount, or drive the payable to zero.
 *
 * ### Guests
 *
 * A guest has no identity, so the per-customer cap and the first-order check
 * cannot be evaluated. Rather than refuse — which would mean nobody could see a
 * price before signing up — the verdict comes back `provisional: true`. The
 * caller shows the discount as indicative and **re-validates at order creation**,
 * by which time the customer has signed in. Gated by
 * `promoCode.allowForGuestPreview`.
 *
 * @param {object}  args
 * @param {string}  args.code
 * @param {object|null} args.customerId  null for a guest
 * @param {object}  args.voucher         { _id, categoryId, subCategoryId }
 * @param {object}  args.brandId         the brand the claim is against
 * @param {number}  args.billAmount      the raw bill, before any offer
 * @param {number}  args.netBill         bill minus the offer discount
 * @param {number}  args.convenienceFee
 * @param {object}  args.config          `getCustomerConfig().promoCode`
 * @param {boolean} [args.offerApplied]  whether a voucher offer is in play
 * @returns {Promise<object>} verdict
 */
exports.validateCustomerPromoCode = async ({
  code,
  customerId,
  voucher,
  brandId,
  billAmount,
  netBill,
  convenienceFee,
  config = {},
  offerApplied = false,
}) => {
  if (!code) return { ok: false, reason: null };
  if (!config.isEnabled) {
    return { ok: false, reason: PROMO_REJECTION.DISABLED };
  }

  const isGuest = !customerId;
  if (isGuest && !config.allowForGuestPreview) {
    return { ok: false, reason: PROMO_REJECTION.REQUIRES_LOGIN };
  }

  const normalized = String(code).trim().toUpperCase();
  const promo = await PromoCode.findOne({
    code: normalized,
    isDeleted: false,
    ...buildAudienceFilter(PROMO_AUDIENCE.CUSTOMER),
  });

  // A vendor code reaching here is reported exactly like a code that does not
  // exist. Saying "this code is not for you" would confirm it exists, which
  // turns the endpoint into an oracle for enumerating live campaigns.
  if (!promo) return { ok: false, reason: PROMO_REJECTION.NOT_FOUND };

  // A promo on top of no offer at all is a pure giveaway with no vendor supply
  // behind it, so it is off unless an admin turned it on.
  if (!offerApplied && !config.allowWhenNoOffer) {
    return {
      ok: false,
      reason: PROMO_REJECTION.NO_OFFER_APPLIED,
      promoCode: promo,
    };
  }

  // ---------- what the discount comes off ----------
  const appliesTo = promo.appliesTo || PROMO_APPLIES_TO.NET_BILL;
  const base =
    appliesTo === PROMO_APPLIES_TO.CONVENIENCE_FEE
      ? round2(convenienceFee || 0)
      : round2(netBill || 0);

  // ---------- minimum bill ----------
  //
  // Checked against the RAW bill, deliberately — not against `base`, which is
  // what `assertPromoWindowAndCaps` would compare a `minBase` to.
  //
  // A customer reading "minimum order Rs300" means the bill they typed. Telling
  // them a Rs320 bill is too small because the voucher discount already took it
  // to Rs280 is indefensible, and it would make the minimum depend on which
  // offer happened to apply. So the shared gate is called with no `minBase` and
  // the rule lives here.
  if (promo.minBillAmount && round2(billAmount) < promo.minBillAmount) {
    return {
      ok: false,
      reason: PROMO_REJECTION.MIN_BILL_AMOUNT,
      promoCode: promo,
    };
  }

  // ---------- shared gates: live, in window, platform cap, worth ----------
  const verdict = assertPromoWindowAndCaps({ promo, base });
  if (!verdict.ok) return verdict;

  // ---------- customer-specific scope ----------
  if (!inScope(promo.voucherIds, voucher?._id)) {
    return {
      ok: false,
      reason: PROMO_REJECTION.VOUCHER_NOT_ELIGIBLE,
      promoCode: promo,
    };
  }
  if (!inScope(promo.brandIds, brandId)) {
    return {
      ok: false,
      reason: PROMO_REJECTION.BRAND_NOT_ELIGIBLE,
      promoCode: promo,
    };
  }
  // A voucher carries both; either matching is enough, because an admin scoping
  // by "Food" means the category the customer would recognise.
  if (promo.categoryIds?.length) {
    const matched =
      inScope(promo.categoryIds, voucher?.categoryId) ||
      (voucher?.subCategoryId &&
        promo.categoryIds.some((id) => sameId(id, voucher.subCategoryId)));
    if (!matched) {
      return {
        ok: false,
        reason: PROMO_REJECTION.CATEGORY_NOT_ELIGIBLE,
        promoCode: promo,
      };
    }
  }

  // ---------- per-customer rules ----------
  //
  // A guest cannot be checked against either. The verdict is marked provisional
  // and the caller re-validates once they sign in.
  if (isGuest) {
    return { ...verdict, provisional: true, appliesTo, promoBase: base };
  }

  if (promo.firstOrderOnly) {
    // Counted from paid transactions rather than from claims. `VoucherClaim`
    // arrives with Phase 1B, but the transaction is written for every claim and
    // exists today — and `verified: true` is the honest reading of "has ordered
    // before": an abandoned checkout is not a first order used up.
    const prior = await Transaction.countDocuments(
      buildTransactionFilter({
        purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
        customerId,
        verified: true,
      }),
    );
    if (prior > 0) {
      return {
        ok: false,
        reason: PROMO_REJECTION.FIRST_ORDER_ONLY,
        promoCode: promo,
      };
    }
  }

  // Counts the ledger, not `usedCount`. RESERVED rows count too, so a customer
  // cannot hold two open checkouts against a single-use code and pay for both.
  // Scoped by audience: a brand's claims on the same code are not this
  // customer's, and both audiences share this collection.
  const customerUses = await PromoCodeUsage.countDocuments({
    promoCodeId: promo._id,
    customerId,
    audience: PROMO_AUDIENCE.CUSTOMER,
    status: {
      $in: [PROMO_USAGE_STATUS.RESERVED, PROMO_USAGE_STATUS.CONSUMED],
    },
  });
  if (customerUses >= (promo.perCustomerUsageLimit ?? 1)) {
    return {
      ok: false,
      reason: PROMO_REJECTION.CUSTOMER_LIMIT_REACHED,
      promoCode: promo,
    };
  }

  return { ...verdict, provisional: false, appliesTo, promoBase: base };
};

/**
 * Split a discount between the brand and the platform.
 *
 * Kept beside the validator because the split is decided from the **same**
 * document, and computing it anywhere else means reading `costBearing` twice.
 * The caller freezes the result onto the `PromoCodeUsage` row at claim time, so
 * a settlement never re-derives it from a code that may since have been edited.
 *
 * `vendorCost + platformCost === discount`, always: the platform takes the
 * remainder rather than its own rounded share, so a rounding difference can
 * never leave a paisa unaccounted for.
 */
exports.splitPromoCost = (promo, discount) => {
  const total = round2(discount || 0);
  const mode = promo?.costBearing?.mode || PROMO_COST_BEARING_MODE.PLATFORM;

  if (mode === PROMO_COST_BEARING_MODE.VENDOR) {
    return { vendorCost: total, platformCost: 0 };
  }
  if (mode === PROMO_COST_BEARING_MODE.SHARED) {
    const vendorCost = round2(
      (total * (promo.costBearing.vendorPercent || 0)) / 100,
    );
    return { vendorCost, platformCost: round2(total - vendorCost) };
  }
  return { vendorCost: 0, platformCost: total };
};
