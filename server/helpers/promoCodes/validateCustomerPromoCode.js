const PromoCode = require("../../models/PromoCode");
const PromoCodeUsage = require("../../models/PromoCodeUsage");
const Transaction = require("../../models/Transaction");
const {
  PROMO_USAGE_STATUS,
  PROMO_REJECTION,
  PROMO_AUDIENCE,
  PROMO_COST_BEARING_MODE,
} = require("../../constants/promoCode");
const { evaluateCustomerPromo } = require("./evaluateCustomerPromo");
const { buildAudienceFilter } = require("./buildAudienceFilter");
const { round2 } = require("../subscribeds/calculatePricing");
const { buildTransactionFilter } = require("../transactions");
const { TRANSACTION_PURPOSE } = require("../../constants/transaction");

/**
 * Resolve a **customer voucher-claim** promo code and compute what it is worth.
 *
 * The vendor twin is `validatePromoCode`. Everything either of them decides
 * about a code now lives in a pure evaluator — `evaluateCustomerPromo` here,
 * `evaluateVendorPromo` there — which the promo **listing** calls as well. This
 * file is the database half: find the code, count what the per-customer gates
 * need, and hand both to the evaluator.
 *
 * That split is what stops the drawer a customer picks a code from and the
 * checkout that applies it from ever disagreeing. Before it existed there was
 * only one caller, so the rules sat inline; a second caller with its own copy
 * would have meant the app offering codes that fail on Apply.
 *
 * Returns a verdict rather than throwing, so the preview endpoint can render a
 * disabled Apply button with a reason while order creation turns the same
 * verdict into a 422. Silently charging full price on a code the customer
 * believes they applied is not acceptable.
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
  //
  // ⚠️ A hidden code (`isPublic: false`) is deliberately **not** excluded. That
  // flag decides whether we hand a code out in the listing, never whether it
  // works when typed — a code mailed to one customer has to be redeemable by
  // them, and that is the entire point of a targeted campaign.
  if (!promo) return { ok: false, reason: PROMO_REJECTION.NOT_FOUND };

  const context = {
    promo,
    voucher,
    brandId,
    billAmount,
    netBill,
    convenienceFee,
    config,
    offerApplied,
    isGuest,
  };

  /**
   * First pass with no counts.
   *
   * Every gate except the two per-customer ones is decided from the document
   * and this checkout alone, so a code rejected here is rejected whatever the
   * counts say — and a rejected code is the common case on a typed field. Doing
   * it this way keeps the two count queries off that path entirely, without
   * either caller holding its own copy of the rules.
   *
   * ⚠️ The zeros are the **permissive** reading, so this pass may only be
   * trusted when it says no. A guest stops here by design: `provisional: true`
   * is exactly "the per-customer gates were not run".
   */
  const firstPass = evaluateCustomerPromo(context);
  if (!firstPass.ok || isGuest) return firstPass;

  const [priorOrderCount, customerUsageCount] = await Promise.all([
    // Counted from paid transactions rather than from claims: the transaction is
    // written for every claim, and `verified: true` is the honest reading of
    // "has ordered before" — an abandoned checkout is not a first order used up.
    promo.firstOrderOnly
      ? Transaction.countDocuments(
          buildTransactionFilter({
            purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
            customerId,
            verified: true,
          }),
        )
      : 0,
    // Counts the ledger, not `usedCount`. RESERVED rows count too, so a customer
    // cannot hold two open checkouts against a single-use code and pay for both.
    // Scoped by audience: a brand's claims on the same code are not this
    // customer's, and both audiences share this collection.
    PromoCodeUsage.countDocuments({
      promoCodeId: promo._id,
      customerId,
      audience: PROMO_AUDIENCE.CUSTOMER,
      status: {
        $in: [PROMO_USAGE_STATUS.RESERVED, PROMO_USAGE_STATUS.CONSUMED],
      },
    }),
  ]);

  return evaluateCustomerPromo({
    ...context,
    priorOrderCount,
    customerUsageCount,
  });
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
