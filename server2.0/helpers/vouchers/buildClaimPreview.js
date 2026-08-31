const Voucher = require("../../models/Voucher");
const VoucherVersion = require("../../models/VoucherVersion");
const VoucherSubBrand = require("../../models/VoucherSubBrand");
const SubBrand = require("../../models/SubBrand");
const Brand = require("../../models/Brand");
const Customer = require("../../models/Customer");
const VoucherUsage = require("../../models/VoucherUsage");
const Subscribed = require("../../models/Subscribed");
// Required for its side effect: `populate("locationId")` below needs the model
// registered, and a helper must not depend on some other file having loaded it
// first. Without this the preview works inside the app and throws
// "Schema hasn't been registered" in a script or a test.
require("../../models/Location");

const { throwError } = require("../../utils");
const { VOUCHER_STATUSES, VOUCHER_USAGE_TYPE } = require("../../constants/voucher");
const { SUBSCRIBED_STATUS } = require("../../constants/subscription");
const { getCustomerConfig } = require("../settings");
const { resolveCustomerId } = require("../customers");
const {
  validateCustomerPromoCode,
  splitPromoCost,
} = require("../promoCodes");
const { resolveClaimOffer } = require("./resolveClaimOffer");
const { calculateVoucherPricing } = require("./calculateVoucherPricing");
const { buildVoucherOrderSummary } = require("./buildVoucherOrderSummary");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Everything a claim checkout renders, and whether the customer may proceed.
 *
 * **Shared by the preview endpoint and by order creation.** That is the whole
 * point: the amount shown is the amount that reaches Razorpay because there is
 * one implementation of the arithmetic, not two that have to be kept in step.
 * The vendor side does the same thing with `buildCheckoutPreview`.
 *
 * Pure read — performs no writes.
 *
 * ### Hard errors vs soft blocks
 *
 * They are different things and the distinction is deliberate:
 *
 *  - **Throws** when the request itself is wrong: an unknown voucher, an outlet
 *    that is not linked, a bill above the cap, an offer the customer named that
 *    cannot apply. There is nothing to render.
 *  - **`canClaim: false` with a reason** when the request is fine but the answer
 *    is no: the brand is not approved, the vendor's plan has lapsed, the offer
 *    has already been used. The page still shows the voucher and the price, with
 *    the button disabled and the reason next to it.
 *
 * A soft block that threw would leave the customer staring at an error toast
 * with no idea what they were looking at.
 *
 * ### `strictPromo`
 *
 * Preview reports an unusable promo code softly so the page can render the Apply
 * error inline. Order creation passes `strictPromo: true` and the same rejection
 * becomes a 422 — silently charging full price on a code the customer believes
 * they applied is not acceptable.
 *
 * @param {object}  args
 * @param {string}  args.voucherId
 * @param {string}  args.outletId
 * @param {number}  args.billAmount
 * @param {string}  [args.offerId]    the customer's explicit choice
 * @param {string}  [args.promoCode]
 * @param {object}  [args.actor]      the request; `customerId` may be absent (guest)
 * @param {object}  [options]
 * @param {boolean} [options.strictPromo]
 */
exports.buildClaimPreview = async (
  { voucherId, outletId, billAmount, offerId = null, promoCode = null, actor = {} },
  { strictPromo = false } = {},
) => {
  const config = await getCustomerConfig();
  const customerId = resolveCustomerId(actor);
  const isGuest = !customerId;

  // ---------------- the request must make sense ----------------
  if (billAmount > config.claim.maxBillAmount) {
    throwError(
      422,
      `Bill amount cannot exceed ${config.currencySymbol}${config.claim.maxBillAmount.toLocaleString("en-IN")}.`,
    );
  }

  const voucher = await Voucher.findOne({
    _id: voucherId,
    isActive: true,
    isDeleted: false,
  }).select("_id name categoryId subCategoryId brandId");
  if (!voucher) throwError(404, "Voucher not found.");

  const now = new Date();
  const version = await VoucherVersion.findOne({
    voucherId: voucher._id,
    // `VOUCHER_STATUSES.PUBLISHED`, not the string. The previous implementation
    // hardcoded "PUBLISHED" while the constant already existed.
    status: VOUCHER_STATUSES.PUBLISHED,
    isActive: true,
    isDeleted: false,
    startAt: { $lte: now },
    endAt: { $gt: now },
  }).sort({ versionNumber: -1 });
  if (!version) throwError(400, "Voucher is not currently available.");

  const mapping = await VoucherSubBrand.findOne({
    voucherVersionId: version._id,
    subBrandId: outletId,
    isActive: true,
    isDeleted: false,
  }).select("_id brandId");
  if (!mapping) {
    throwError(400, "Selected outlet is not linked with this voucher.");
  }

  const outlet = await SubBrand.findOne({
    _id: outletId,
    isActive: true,
    isDeleted: false,
  })
    .select("_id uniqueId storeId brandId geo locationId")
    // The outlet's state decides place of supply, and it lives on the linked
    // Location. Populated here rather than fetched later so the whole preview
    // still costs one pass.
    .populate({ path: "locationId", select: "state city" });
  if (!outlet) throwError(400, "Selected outlet is currently unavailable.");

  const brandId = outlet.brandId || mapping.brandId || voucher.brandId;

  /**
   * A signed-in customer whose account has been deactivated or deleted.
   *
   * Read separately rather than off `req.customerId`: the populated document
   * there is projected with `-isDeleted`, so the field simply is not present and
   * checking it would always pass.
   */
  if (!isGuest) {
    const account = await Customer.findById(customerId)
      .select("_id isActive isDeleted")
      .lean();
    if (!account || account.isDeleted || account.isActive === false) {
      throwError(403, "This account is no longer active.");
    }
  }

  const [brand, usedOfferRows] = await Promise.all([
    Brand.findById(brandId)
      .select("_id brandName isActive isApproved isDeleted isSubscribed subscribedId")
      .lean(),
    // Only a signed-in customer can have used anything. A guest is shown every
    // offer, and the once-per-user rule is re-checked once they sign in.
    isGuest
      ? Promise.resolve([])
      : VoucherUsage.find({
          customerId,
          voucherId: voucher._id,
          isOncePerUser: true,
          isReversed: false,
        })
          .select("offerId")
          .lean(),
  ]);

  const usedOfferIds = usedOfferRows.map((row) => row.offerId).filter(Boolean);

  // ---------------- which offer ----------------
  const resolved = resolveClaimOffer({
    offers: version.offers || [],
    billAmount,
    offerId,
    usedOfferIds,
    now,
    currencySymbol: config.currencySymbol,
  });

  // An offer the customer **named** that cannot apply is a bad request, not a
  // soft block: they asked for something specific and there is no honest way to
  // render a price for it. Pricing a different offer instead would mean the
  // screen and the charge disagree about what was bought.
  if (offerId && resolved.reason) {
    throwError(422, resolved.reason);
  }

  const notices = [];

  // ---------------- pricing, without the promo first ----------------
  //
  // The promo has to be judged against the same figures it will discount, and
  // both of those — the net bill and the fee — depend on which offer applied.
  /**
   * Place of supply for a B2C service is where it is consumed — this outlet.
   *
   * Only a state **name** is available: `Location` carries no 2-digit GST code,
   * and neither does `SubBrand`. `calculateVoucherPricing` compares codes first
   * and falls back to names for exactly this reason. Passed through even while
   * GST is off, so every claim already carries it on the day it is switched on.
   */
  const placeOfSupply = {
    stateCode: null,
    state: outlet.locationId?.state || null,
  };

  const basePricing = calculateVoucherPricing({
    billAmount,
    offer: resolved.offer,
    config,
    placeOfSupply,
  });

  // ---------------- the promo code ----------------
  let promoVerdict = { ok: false, reason: null };
  if (promoCode) {
    promoVerdict = await validateCustomerPromoCode({
      code: promoCode,
      customerId,
      voucher,
      brandId,
      billAmount,
      netBill: basePricing.netBill,
      convenienceFee: basePricing.convenienceFee,
      config: config.promoCode,
      offerApplied: resolved.offerApplied,
    });

    if (!promoVerdict.ok && strictPromo) {
      throwError(422, promoVerdict.reason || "This promo code is not valid.");
    }
    if (!promoVerdict.ok && promoVerdict.reason) {
      notices.push(promoVerdict.reason);
    }
  }

  const promoCost = promoVerdict.ok
    ? splitPromoCost(promoVerdict.promoCode, promoVerdict.discount)
    : null;

  const pricing = promoVerdict.ok
    ? calculateVoucherPricing({
        billAmount,
        offer: resolved.offer,
        promo: promoVerdict,
        promoCost,
        config,
        placeOfSupply,
      })
    : basePricing;

  // ---------------- gates ----------------
  let canClaim = true;
  let blockedReason = null;
  const block = (reason) => {
    // First reason wins. A page showing three reasons at once tells the customer
    // nothing about which one to act on.
    if (canClaim) {
      canClaim = false;
      blockedReason = reason;
    }
  };

  if (!config.claim.isEnabled) {
    block("Voucher claims are temporarily unavailable. Please try again later.");
  }

  if (!brand || brand.isDeleted || brand.isActive === false) {
    block("This brand is not accepting claims right now.");
  } else if (!brand.isApproved) {
    // Deliberately worded the same as the line above. Which internal state a
    // brand is in is not the customer's business.
    block("This brand is not accepting claims right now.");
  }

  /**
   * The vendor's own subscription.
   *
   * A brand whose plan has lapsed is not selling through Trydood, and taking a
   * customer's money for a vendor we are no longer serving is the wrong default.
   * `vendorPlanExpiredGraceDays` covers the plan that lapsed hours ago and is
   * about to be renewed.
   */
  if (canClaim && !config.claim.allowWhenVendorPlanExpired && brand) {
    const active = await Subscribed.findOne({
      brandId: brand._id,
      status: SUBSCRIBED_STATUS.ACTIVE,
      isDeleted: false,
    })
      .select("_id endDate")
      .lean();

    if (!active) {
      const grace = config.claim.vendorPlanExpiredGraceDays;
      const recentlyLapsed = grace
        ? await Subscribed.findOne({
            brandId: brand._id,
            isDeleted: false,
            endDate: { $gte: new Date(now.getTime() - grace * DAY_MS) },
          })
            .select("_id")
            .lean()
        : null;

      if (!recentlyLapsed) {
        block("This brand is not accepting claims right now.");
      }
    }
  }

  /**
   * Every offer this voucher had was once-per-user, and this customer has used
   * them all.
   *
   * Distinct from "the bill is too small", which is not a block at all — there
   * the customer can simply spend more. Here nothing they do will help, so the
   * button is disabled and says so.
   */
  if (canClaim && !resolved.offerApplied && !isGuest && usedOfferIds.length) {
    const usable = (version.offers || []).filter(
      (offer) =>
        offer.isActive !== false &&
        offer.isDeleted !== true &&
        !(
          offer.usageType === VOUCHER_USAGE_TYPE.ONCE_PER_USER &&
          usedOfferIds.some((id) => String(id) === String(offer._id))
        ),
    );
    if (!usable.length) {
      block("You have already used every offer on this voucher.");
    }
  }

  // ---------------- notices ----------------
  if (!resolved.offerApplied && !offerId) {
    notices.push(
      version.offers?.length
        ? "No offer applies to this bill amount. You can still pay your bill through Trydood."
        : "This voucher has no offers right now. You can still pay your bill through Trydood.",
    );
  }
  if (!resolved.offerApplied && pricing.convenienceFee > 0) {
    // Config allows it, but the customer is paying more than they would have
    // without us. It must be said out loud rather than buried in a total.
    notices.push(
      `A convenience fee of ${config.currencySymbol}${pricing.convenienceFee} applies even though no offer was available.`,
    );
  }
  if (promoVerdict.ok && promoVerdict.provisional) {
    notices.push("Log in to confirm this promo code before paying.");
  }

  return {
    voucher: {
      id: voucher._id,
      name: voucher.name,
      categoryId: voucher.categoryId,
      subCategoryId: voucher.subCategoryId,
    },
    version: { id: version._id, versionNumber: version.versionNumber },
    outlet: { id: outlet._id, uniqueId: outlet.uniqueId, storeId: outlet.storeId },
    // New in this phase. The checkout has to name who is being paid.
    brand: brand
      ? { id: brand._id, name: brand.brandName, isApproved: Boolean(brand.isApproved) }
      : null,

    billAmount: pricing.billAmount,
    offerApplied: resolved.offerApplied,
    selectedOffer:
      resolved.eligibleOffers.find(
        (offer) => String(offer.offerId) === String(resolved.offer?._id),
      ) || null,
    eligibleOffers: resolved.eligibleOffers,

    /**
     * The pricing block, plus three names the app already reads.
     *
     * The block itself was rewritten this phase: `discountAmount` became
     * `offerDiscount`, `payableAmount` became `totalPayable`, `totalSavings`
     * became `youSaved` — clearer names, and ones that do not collide with the
     * subscription block's meaning of the same words.
     *
     * The response was promised as **additive**, and a live app is reading the
     * old names right now. So they are echoed here, in the response only. The
     * stored `voucherPricingSchema` carries the new names alone, because a
     * frozen record should have one name per number and not two.
     *
     * ⚠️ Deprecated. Remove once the app has moved, and not before — dropping
     * them early turns every checkout screen into a blank price.
     */
    pricing: {
      ...pricing,
      discountAmount: pricing.offerDiscount,
      payableAmount: pricing.totalPayable,
      totalSavings: pricing.youSaved,
    },
    orderSummary: buildVoucherOrderSummary(pricing, config),

    promo: {
      supported: config.promoCode.isEnabled,
      applied: promoVerdict.ok
        ? {
            code: promoVerdict.promoCode.code,
            description: promoVerdict.promoCode.description || null,
            discount: pricing.promoDiscount,
            appliesTo: pricing.promoAppliesTo,
          }
        : null,
      // A guest's per-customer cap and first-order check cannot be evaluated, so
      // the discount is indicative until they sign in and it is re-validated.
      provisional: Boolean(promoVerdict.ok && promoVerdict.provisional),
      message: promoVerdict.ok
        ? `Promo code ${promoVerdict.promoCode.code} applied`
        : promoVerdict.reason,
    },

    canClaim,
    blockedReason,
    // The button says "Log in to continue" rather than being disabled.
    requiresLogin: isGuest,
    notices,

    // Not part of the rendered response — order creation needs the resolved
    // documents and would otherwise have to load them a second time.
    _internal: {
      voucher,
      version,
      outlet,
      brand,
      brandId,
      offer: resolved.offer,
      promoVerdict,
      promoCost,
      config,
      customerId,
    },
  };
};
