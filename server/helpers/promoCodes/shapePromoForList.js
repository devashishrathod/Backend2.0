const {
  PROMO_AUDIENCE,
  PROMO_APPLIES_TO,
  PROMO_APPLIES_TO_LABEL,
} = require("../../constants/promoCode");
const { buildPromoTerms, buildPromoHeadline } = require("./buildPromoTerms");

/**
 * How many uses the caller has left on a code, or `null` for "not capped".
 *
 * Their own number, never the platform's — see the note in `buildPromoTerms`.
 */
const usesLeft = (limit, used) =>
  limit === null || limit === undefined
    ? null
    : Math.max(0, limit - (used || 0));

/**
 * One row of a promo code listing, for the side that asked for it.
 *
 * ### This is an allow-list, and it has to stay one
 *
 * A `PromoCode` document carries things neither a customer nor a vendor may
 * see, and the dangerous ones do not look dangerous:
 *
 *  - **`costBearing`** is who funds the discount — our margin split with the
 *    brand. Handing it to a vendor tells them exactly what the platform keeps;
 *    handing it to a customer publishes it.
 *  - **`usedCount` / `totalUsageLimit`** describe the campaign's size and burn
 *    rate, which is a competitor's question, not a customer's.
 *  - **`isPublic`, `createdBy`, `updatedBy`, `isDeleted`** are internal state.
 *
 * So every field is named here deliberately. ⚠️ Never spread the document — a
 * `...promo` would leak all four the day it was written, and every field added
 * to the schema afterwards, silently and for ever.
 *
 * @param {object} promo              the PromoCode document (lean or hydrated)
 * @param {object} args
 * @param {string} args.audience      which listing this row belongs to
 * @param {object} [args.scopeNames]  resolved names for the derived terms
 * @param {number} [args.used]        uses the caller has already taken
 * @param {boolean} args.isApplicable can the caller use it right now
 * @param {string|null} args.reason   why not, when they cannot
 * @param {object|null} [args.savings] { discount, base } when a context was given
 * @param {string} [args.currencySymbol]
 */
exports.shapePromoForList = (
  promo,
  {
    audience,
    scopeNames = {},
    used = 0,
    isApplicable,
    reason = null,
    savings = null,
    currencySymbol,
  },
) => {
  const isCustomer = audience === PROMO_AUDIENCE.CUSTOMER;

  const shared = {
    _id: promo._id,
    code: promo.code,
    headline: buildPromoHeadline(promo, { currencySymbol }),
    description: promo.description || null,

    discountType: promo.discountType,
    discountPercent: promo.discountPercent ?? 0,
    discountAmount: promo.discountAmount ?? 0,
    maxDiscountAmount: promo.maxDiscountAmount ?? null,

    validFrom: promo.validFrom ?? null,
    validTill: promo.validTill ?? null,

    terms: buildPromoTerms(promo, { audience, scopeNames, currencySymbol }),

    isApplicable: Boolean(isApplicable),
    // Null when it applies. The rejection strings are the same ones checkout
    // returns, so the drawer and the Apply button never word it differently.
    reason: isApplicable ? null : reason || null,
    /**
     * What it is actually worth, and what it comes off.
     *
     * `null` when the caller sent no checkout context — a catalogue cannot price
     * a discount, and returning `0` there would read as "worth nothing" rather
     * than "not priced yet".
     */
    savings,
  };

  if (isCustomer) {
    const limit = promo.perCustomerUsageLimit ?? 1;
    const appliesTo = promo.appliesTo || PROMO_APPLIES_TO.NET_BILL;
    return {
      ...shared,
      minBillAmount: promo.minBillAmount ?? 0,
      appliesTo,
      appliesToLabel: PROMO_APPLIES_TO_LABEL[appliesTo] || null,
      firstOrderOnly: Boolean(promo.firstOrderOnly),
      usage: {
        perCustomerLimit: limit,
        usedByYou: used,
        usesLeft: usesLeft(limit, used),
      },
    };
  }

  const limit = promo.perBrandUsageLimit ?? 1;
  return {
    ...shared,
    minOrderValue: promo.minOrderValue ?? 0,
    applicableActions: promo.applicableActions || [],
    firstTimeOnly: Boolean(promo.firstTimeOnly),
    usage: {
      perBrandLimit: limit,
      usedByYourBrand: used,
      usesLeft: usesLeft(limit, used),
    },
  };
};
