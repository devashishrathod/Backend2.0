const {
  PROMO_AUDIENCE,
  PROMO_APPLIES_TO,
  PROMO_APPLIES_TO_LABEL,
  PROMO_APPLICABLE_ACTION_LABEL,
  PROMO_DISCOUNT_TYPES,
  PROMO_CODE_LIMITS,
} = require("../../constants/promoCode");
const { CUSTOMER_CURRENCY_DEFAULTS } = require("../../constants/customer");
// By file rather than the notifications barrel: that barrel pulls in the notice
// builders, which pull in models, and a formatter has no business dragging them
// into the promo listing.
const { formatDate } = require("../notifications/formatDateTime");

/**
 * `₹1,000` — the same grouping every other customer-facing string uses.
 */
const money = (amount, symbol) =>
  `${symbol}${Number(amount || 0).toLocaleString("en-IN")}`;

/**
 * "A, B and 3 more" — a scope list a phone can render.
 *
 * Returns `null` when there is nothing to name, which is **not** the same as an
 * empty list: a code scoped to five brands whose names could not be resolved
 * must still say it is restricted. The caller turns `null` into the generic
 * wording rather than printing "Valid at ." — a term that reads as no
 * restriction at all is worse than a vague one.
 */
const nameList = (names) => {
  const cleaned = (names || []).filter(Boolean);
  if (!cleaned.length) return null;

  const shown = cleaned.slice(0, PROMO_CODE_LIMITS.MAX_SCOPE_NAMES);
  const rest = cleaned.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
};

/**
 * The terms shown on a listed promo code, derived from the code itself.
 *
 * ### Why these are generated rather than typed
 *
 * Every line below restates a rule the validator already enforces — the minimum
 * bill, the window, the per-customer cap, the brand and category scope. A term
 * an admin types can say ₹200 while the code enforces ₹300, and nothing
 * anywhere would notice: the listing would read correctly, the customer would
 * believe it, and the rejection would arrive at checkout with no way to tell
 * who was wrong. Generating them means a term cannot be a lie about the code it
 * sits on; the only way to change one is to change the rule.
 *
 * `PromoCode.termsAndConditions` still exists for what no field expresses —
 * "dine-in only", "not valid with other offers" — and those lines are appended
 * after the derived ones.
 *
 * ⚠️ **Nothing here names a platform-wide number.** `totalUsageLimit` and
 * `usedCount` describe the campaign, not the caller: how many of a code are
 * left, and how fast they are going, is exactly what a competitor would want
 * and nothing a customer needs. The per-customer and per-brand caps are theirs
 * and are said plainly.
 *
 * @param {object} promo                   the PromoCode document
 * @param {object} [options]
 * @param {string} [options.audience]      which side is reading — defaults to the code's own
 * @param {object} [options.scopeNames]    { brands, categories, vouchers, plans } resolved names
 * @param {string} [options.currencySymbol]
 * @returns {string[]}
 */
exports.buildPromoTerms = (
  promo,
  { audience, scopeNames = {}, currencySymbol } = {},
) => {
  if (!promo) return [];

  const symbol = currencySymbol || CUSTOMER_CURRENCY_DEFAULTS.currencySymbol;
  const side = audience || promo.audience || PROMO_AUDIENCE.VENDOR;
  const isCustomer = side === PROMO_AUDIENCE.CUSTOMER;
  const terms = [];

  if (isCustomer) {
    const appliesTo = promo.appliesTo || PROMO_APPLIES_TO.NET_BILL;
    const label = PROMO_APPLIES_TO_LABEL[appliesTo];
    if (label) terms.push(`Discount applies to ${label}.`);

    if (promo.minBillAmount > 0) {
      terms.push(`Minimum bill of ${money(promo.minBillAmount, symbol)}.`);
    }
  } else if (promo.minOrderValue > 0) {
    terms.push(
      `Valid on plans priced ${money(promo.minOrderValue, symbol)} or more, after the plan's own discount.`,
    );
  }

  // Only a PERCENT code can be capped — `assertCoherent` refuses the field on a
  // FLAT code, which is already a fixed amount.
  if (
    promo.discountType === PROMO_DISCOUNT_TYPES.PERCENT &&
    promo.maxDiscountAmount > 0
  ) {
    terms.push(`Maximum discount of ${money(promo.maxDiscountAmount, symbol)}.`);
  }

  // A code with no end date runs indefinitely and simply says nothing, rather
  // than claiming a date it does not have.
  if (promo.validFrom && new Date(promo.validFrom) > new Date()) {
    terms.push(`Valid from ${formatDate(promo.validFrom)}.`);
  }
  if (promo.validTill) {
    terms.push(`Valid till ${formatDate(promo.validTill)}.`);
  }

  if (isCustomer) {
    const perCustomer = promo.perCustomerUsageLimit ?? 1;
    terms.push(
      perCustomer === 1
        ? "Can be used once per customer."
        : `Can be used up to ${perCustomer} times per customer.`,
    );

    if (promo.firstOrderOnly) {
      terms.push("Valid on your first order only.");
    }

    if (promo.brandIds?.length) {
      const names = nameList(scopeNames.brands);
      terms.push(names ? `Valid at ${names}.` : "Valid at selected brands.");
    }
    if (promo.categoryIds?.length) {
      const names = nameList(scopeNames.categories);
      terms.push(
        names
          ? `Valid on vouchers in ${names}.`
          : "Valid on vouchers in selected categories.",
      );
    }
    if (promo.voucherIds?.length) {
      const names = nameList(scopeNames.vouchers);
      terms.push(
        names
          ? `Valid on these vouchers: ${names}.`
          : "Valid on selected vouchers only.",
      );
    }
  } else {
    const perBrand = promo.perBrandUsageLimit ?? 1;
    terms.push(
      perBrand === 1
        ? "Can be used once per brand."
        : `Can be used up to ${perBrand} times per brand.`,
    );

    if (promo.firstTimeOnly) {
      terms.push("Valid on a first subscription purchase only.");
    }

    if (promo.subscriptionIds?.length) {
      const names = nameList(scopeNames.plans);
      terms.push(names ? `Valid on ${names}.` : "Valid on selected plans only.");
    }
    if (promo.applicableActions?.length) {
      const labels = promo.applicableActions
        .map((action) => PROMO_APPLICABLE_ACTION_LABEL[action])
        .filter(Boolean);
      if (labels.length) terms.push(`Valid on ${labels.join(", ")}.`);
    }
  }

  // The admin's own lines last: the derived ones are the rules, these are the
  // footnotes.
  for (const line of promo.termsAndConditions || []) {
    const trimmed = String(line || "").trim();
    if (trimmed) terms.push(trimmed);
  }

  return terms;
};

/**
 * The headline on the card — "50% OFF up to ₹100", "₹150 OFF".
 *
 * Derived for the same reason the terms are: a stored headline can outlive the
 * discount it describes, and an admin editing 50% to 30% would leave the old
 * number on the card.
 */
exports.buildPromoHeadline = (promo, { currencySymbol } = {}) => {
  if (!promo) return null;
  const symbol = currencySymbol || CUSTOMER_CURRENCY_DEFAULTS.currencySymbol;

  if (promo.discountType === PROMO_DISCOUNT_TYPES.PERCENT) {
    const percent = promo.discountPercent || 0;
    return promo.maxDiscountAmount > 0
      ? `${percent}% OFF up to ${money(promo.maxDiscountAmount, symbol)}`
      : `${percent}% OFF`;
  }

  return `${money(promo.discountAmount, symbol)} OFF`;
};
