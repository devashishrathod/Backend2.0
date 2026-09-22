const PromoCode = require("../../models/PromoCode");
const PromoCodeUsage = require("../../models/PromoCodeUsage");
const Transaction = require("../../models/Transaction");
const { pagination, throwError } = require("../../utils");
const {
  PROMO_AUDIENCE,
  PROMO_USAGE_STATUS,
  PROMO_REJECTION,
  PROMO_CODE_LIMITS,
} = require("../../constants/promoCode");
const { TRANSACTION_PURPOSE } = require("../../constants/transaction");
const {
  buildListedPromoFilter,
  evaluateCustomerPromo,
  shapePromoForList,
  resolvePromoScopeNames,
  pickScopeNames,
} = require("../../helpers/promoCodes");
const { buildClaimPreview } = require("../../helpers/vouchers");
const { buildTransactionFilter } = require("../../helpers/transactions");
const { getCustomerConfig } = require("../../helpers/settings");
const { resolveCustomerId } = require("../../helpers/customers");

/**
 * The checkout the customer is standing at, if they named one.
 *
 * ⚠️ This goes through `buildClaimPreview` rather than pricing anything itself.
 * The promo drawer opens on top of the checkout screen, and the two must agree
 * to the paisa about the bill, the offer and the fee — a second implementation
 * of that arithmetic would drift the first time an offer rule changed, and the
 * customer would see one saving in the drawer and another on the button.
 *
 * It is also the layer that decides the request is wrong: an unknown voucher,
 * an outlet that is not linked, a bill over the cap all throw from there, which
 * is right — there is no honest list to render against a checkout that cannot
 * exist.
 */
const resolveClaimContext = async ({
  voucherId,
  outletId,
  billAmount,
  offerId,
  actor,
}) => {
  const preview = await buildClaimPreview({
    voucherId,
    outletId,
    billAmount,
    offerId,
    actor,
  });

  return {
    voucher: preview._internal.voucher,
    brandId: preview._internal.brandId,
    billAmount: preview.pricing.billAmount,
    netBill: preview.pricing.netBill,
    convenienceFee: preview.pricing.convenienceFee,
    offerApplied: preview.offerApplied,
  };
};

/**
 * What the list was priced against, echoed back.
 *
 * Only figures the customer was already shown on the checkout screen — so the
 * app can prove the drawer and the button agree, without this endpoint becoming
 * a second source for them.
 */
const contextEcho = (context) =>
  context
    ? {
        brandId: context.brandId,
        billAmount: context.billAmount,
        netBill: context.netBill,
        convenienceFee: context.convenienceFee,
        offerApplied: context.offerApplied,
      }
    : null;

/**
 * The promo codes a signed-in customer may pick from.
 *
 * ### Two shapes of the same question
 *
 * With a checkout named (`voucherId` + `outletId` + `billAmount`) every row
 * carries whether it applies **to that bill**, why not when it does not, and
 * what it is actually worth — the drawer the customer taps a code in. With no
 * checkout it is a catalogue: the same codes, the terms, and the gates that can
 * be answered without a bill (already used, first order only), with `savings`
 * and the scope rejections left out rather than guessed. `evaluateCustomerPromo`
 * is told which of the two it is answering; nothing is faked.
 *
 * ### One evaluation per row, not one round trip per row
 *
 * The two gates that need a query — how many times this customer has used each
 * code, and whether they have ordered before — are counted for the **whole
 * page** in one aggregation and one count, then handed to the evaluator. Doing
 * it per row would be two queries a code on a screen opened mid-checkout.
 *
 * ⚠️ Every rule comes from `evaluateCustomerPromo`, the same function
 * `validateCustomerPromoCode` runs at checkout. That is the whole point: a
 * listing with its own copy would eventually offer a code that fails on Apply,
 * and the customer would have no way to tell which screen was lying.
 *
 * @param {object} actor  the request — `customerId` is a populated document
 * @param {object} query  validated query
 */
exports.getCustomerPromoCodes = async (actor, query = {}) => {
  const customerId = resolveCustomerId(actor);
  // The route is behind `isCustomer`, so this is a guard against a future
  // caller rather than a reachable state — but a null customerId here would
  // silently count nobody's usage and hand every capped code back as available.
  if (!customerId) throwError(403, "This listing is for customers only.");

  const page = query.page ? Number(query.page) : 1;
  const limit = query.limit
    ? Number(query.limit)
    : PROMO_CODE_LIMITS.DEFAULT_LIST_LIMIT;

  const config = await getCustomerConfig();
  const promoConfig = config.promoCode;

  const empty = {
    isEnabled: Boolean(promoConfig.isEnabled),
    context: null,
    total: 0,
    totalPages: 0,
    page,
    limit,
    data: [],
  };

  // Switched off platform-wide. An empty list plus the reason, not a 404: the
  // question was fine and the honest answer is "none right now".
  if (!promoConfig.isEnabled) {
    return { ...empty, message: PROMO_REJECTION.DISABLED };
  }

  const context = query.voucherId
    ? await resolveClaimContext({ ...query, actor })
    : null;

  const pipeline = [
    { $match: buildListedPromoFilter(PROMO_AUDIENCE.CUSTOMER) },
    // Newest campaign first. The best-saving-first ordering below is applied to
    // the page, because ranking across pages would mean evaluating every code
    // on the platform against this customer on every request.
    { $sort: { createdAt: -1 } },
  ];

  const result = await pagination(
    PromoCode,
    pipeline,
    page,
    limit,
    "promo code",
    // A customer with no codes on offer is a normal state, not a missing
    // resource — 404 here would put an error screen on a correct answer.
    { allowEmpty: true },
  );

  const promos = result.data;
  if (!promos.length) {
    return { ...empty, ...result, context: contextEcho(context) };
  }

  const [usageRows, priorOrderCount, scopeNames] = await Promise.all([
    // RESERVED counts as used — a customer holding an open checkout against a
    // single-use code must not be offered it a second time.
    PromoCodeUsage.aggregate([
      {
        $match: {
          promoCodeId: { $in: promos.map((promo) => promo._id) },
          customerId,
          audience: PROMO_AUDIENCE.CUSTOMER,
          status: {
            $in: [PROMO_USAGE_STATUS.RESERVED, PROMO_USAGE_STATUS.CONSUMED],
          },
        },
      },
      { $group: { _id: "$promoCodeId", count: { $sum: 1 } } },
    ]),
    // Only when something on the page actually asks. Most pages do not.
    promos.some((promo) => promo.firstOrderOnly)
      ? Transaction.countDocuments(
          buildTransactionFilter({
            purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
            customerId,
            verified: true,
          }),
        )
      : 0,
    resolvePromoScopeNames(promos),
  ]);

  const usedByPromo = new Map(
    usageRows.map((row) => [String(row._id), row.count]),
  );

  const data = promos.map((promo) => {
    const used = usedByPromo.get(String(promo._id)) || 0;
    const verdict = evaluateCustomerPromo({
      ...(context || {}),
      promo,
      config: promoConfig,
      isGuest: false,
      priorOrderCount,
      customerUsageCount: used,
      hasCheckoutContext: Boolean(context),
    });

    return shapePromoForList(promo, {
      audience: PROMO_AUDIENCE.CUSTOMER,
      scopeNames: pickScopeNames(promo, scopeNames),
      used,
      isApplicable: verdict.ok,
      reason: verdict.reason,
      savings:
        verdict.ok && context
          ? {
              discount: verdict.discount,
              base: verdict.promoBase,
              appliesTo: verdict.appliesTo,
            }
          : null,
      currencySymbol: config.currencySymbol,
    });
  });

  /**
   * Usable first, biggest saving first inside that.
   *
   * A code they cannot use yet is still shown — "minimum bill ₹300" is
   * something a customer can act on, and hiding it only raises the question of
   * where their code went. It just does not belong above the ones that work.
   */
  data.sort((a, b) => {
    if (a.isApplicable !== b.isApplicable) return a.isApplicable ? -1 : 1;
    return (b.savings?.discount ?? 0) - (a.savings?.discount ?? 0);
  });

  return {
    isEnabled: true,
    context: contextEcho(context),
    ...result,
    data,
  };
};
