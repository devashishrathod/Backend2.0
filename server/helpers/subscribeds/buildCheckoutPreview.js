const Subscription = require("../../models/Subscription");
const { ROLES } = require("../../constants");
const {
  SUBSCRIPTION_ACTION,
  METERED_ENTITLEMENTS,
  BUCKET_BRAND_FIELDS,
  BUCKET_LABELS,
} = require("../../constants/subscription");
const { throwError } = require("../../utils");
const { getSubscriptionConfig } = require("../settings");
const { resolveEntitlements } = require("../subscriptions");
const { validatePromoCode } = require("../promoCodes");
const { calculateEndDate } = require("./calculateEndDate");
const { calculatePricing } = require("./calculatePricing");
const { buildOrderSummary } = require("./buildOrderSummary");
const { buildBillingDetails } = require("./buildBillingDetails");
const { getActiveSubscription } = require("./getActiveSubscription");
const { resolveSubscriptionAction } = require("./resolveSubscriptionAction");
const { formatDuration, formatSubscriptionType } = require("./formatDuration");

/**
 * Compare what the target plan grants against what the brand is already using,
 * across every metered pool.
 *
 * Existing rows are never deleted on a downgrade, so this reports the shortfall
 * rather than acting on it. The policy that consumes it differs by actor: a
 * vendor is blocked, an admin is allowed and warned.
 */
const buildEntitlementDiff = (brand, entitlements) => {
  const buckets = {};
  let hasOverflow = false;

  for (const key of METERED_ENTITLEMENTS) {
    const fields = BUCKET_BRAND_FIELDS[key];
    const used = brand?.[fields.used] ?? 0;
    const target = entitlements[key] || { limit: 0, isUnlimited: false };
    const overflow = target.isUnlimited
      ? 0
      : Math.max(0, used - (target.limit ?? 0));
    if (overflow > 0) hasOverflow = true;
    buckets[key] = {
      used,
      newLimit: target.isUnlimited ? null : (target.limit ?? 0),
      isUnlimited: Boolean(target.isUnlimited),
      overflowBy: overflow,
      label: BUCKET_LABELS[key]?.many || key,
    };
  }

  return { buckets, hasOverflow };
};

const overflowSentence = (buckets, planName) =>
  Object.entries(buckets)
    .filter(([, bucket]) => bucket.overflowBy > 0)
    .map(
      ([, bucket]) =>
        `${bucket.used} ${bucket.label} but ${planName} allows ${bucket.newLimit}`,
    )
    .join(", ");

/**
 * Assemble everything the checkout page renders, and decide whether the actor
 * may proceed.
 *
 * Shared by the preview endpoint and by order creation, which is what
 * guarantees the amount a vendor is shown is the amount that reaches Razorpay —
 * they are not two implementations of the same arithmetic.
 *
 * Pure read: performs no writes. `getActiveSubscription` may self-heal a stale
 * row, which is a repair, not a checkout side effect.
 *
 * @param {object}  brand         Brand document
 * @param {object}  subscription  the plan being bought
 * @param {object}  actor         { userId, role }
 * @param {object} [options]
 * @param {string} [options.promoCode]
 * @param {boolean}[options.strictPromo]  true for order creation: an unusable
 *        code raises 422 instead of being reported as a soft rejection. Preview
 *        stays soft so the page can render the Apply error inline.
 */
exports.buildCheckoutPreview = async (
  brand,
  subscription,
  actor = {},
  { promoCode = null, strictPromo = false } = {},
) => {
  const isAdmin = actor.role === ROLES.ADMIN;
  const config = await getSubscriptionConfig();

  if (!subscription.durationInDays && !subscription.durationInYears) {
    throwError(
      422,
      `Subscription plan "${subscription.name}" has no duration configured. Please contact support.`,
    );
  }

  const [billing, active] = await Promise.all([
    buildBillingDetails(brand),
    getActiveSubscription(brand._id),
  ]);

  const currentPlan = active?.subscriptionId
    ? await Subscription.findById(active.subscriptionId).lean()
    : null;

  const { action, isSideGrade, current } = resolveSubscriptionAction(
    active,
    currentPlan,
    subscription,
  );

  const startDate = new Date();
  const endDate = calculateEndDate(
    startDate,
    subscription.durationInYears,
    subscription.durationInDays,
  );

  // ---------------- promo code ----------------
  // Priced without the code first, so the promo is evaluated against the same
  // taxable value it will actually discount.
  const basePricing = calculatePricing({
    subscription,
    config,
    buyer: { gstin: billing.gstin, state: billing.state },
  });

  let promoVerdict = { ok: false, reason: null };
  if (promoCode) {
    promoVerdict = await validatePromoCode({
      code: promoCode,
      brand,
      subscription,
      action,
      taxableValue: basePricing.taxableValue,
      isEnabled: config.isPromoCodeEnabled,
    });
    // Order creation must never quietly charge full price on a code the vendor
    // believes they applied.
    if (!promoVerdict.ok && strictPromo) {
      throwError(422, promoVerdict.reason || "This promo code is not valid.");
    }
  }

  const pricing = promoVerdict.ok
    ? calculatePricing({
        subscription,
        config,
        buyer: { gstin: billing.gstin, state: billing.state },
        promoCode: promoVerdict.promoCode.code,
        promoDiscount: promoVerdict.discount,
      })
    : basePricing;

  const { entitlements, source: entitlementsSource } =
    resolveEntitlements(subscription);
  const entitlementDiff = buildEntitlementDiff(brand, entitlements);

  // ---------------- gates ----------------
  const notices = [];
  let canProceed = true;
  let blockedReason = null;

  const block = (reason) => {
    if (canProceed) {
      canProceed = false;
      blockedReason = reason;
    }
  };

  if (!config.isActive) {
    block(
      "Subscription purchases are temporarily unavailable. Please try again later.",
    );
  }

  if (!brand.isApproved && !isAdmin) {
    notices.push(
      "Your brand is still under review. You can subscribe now, but customer-facing features unlock only after approval.",
    );
  }

  if (!isAdmin) {
    if (action === SUBSCRIPTION_ACTION.RENEW && !config.allowVendorRenewal) {
      block(
        "Renewing your plan from here is currently disabled. Please contact support.",
      );
    }
    if (
      action === SUBSCRIPTION_ACTION.UPGRADE &&
      !config.allowVendorUpgrade &&
      !isSideGrade
    ) {
      block(
        "Upgrading your plan from here is currently disabled. Please contact support.",
      );
    }
    if (action === SUBSCRIPTION_ACTION.DOWNGRADE) {
      if (!config.allowVendorDowngrade) {
        block(
          "Downgrading is not permitted. Your current plan provides greater value than the selected option. Please choose a higher-tier plan or contact support.",
        );
      } else if (entitlementDiff.hasOverflow) {
        // Vendors are blocked on overflow; only an admin may grandfather it.
        block(
          `Cannot downgrade — you currently have ${overflowSentence(entitlementDiff.buckets, subscription.name)}. Please remove the extra entries first or contact support.`,
        );
      }
    }
  } else if (action === SUBSCRIPTION_ACTION.DOWNGRADE) {
    if (!config.allowAdminDowngrade) {
      block("Downgrades are disabled in the current platform settings.");
    } else if (entitlementDiff.hasOverflow) {
      // Admin-initiated downgrades grandfather the excess: existing entries keep
      // working, no new ones can be added until usage falls under the limit.
      const parts = Object.entries(entitlementDiff.buckets)
        .filter(([, bucket]) => bucket.overflowBy > 0)
        .map(
          ([, bucket]) =>
            `${bucket.label} ${bucket.used}/${bucket.newLimit} (${bucket.overflowBy} over)`,
        );
      notices.push(
        `This brand will be over its new plan limits — ${parts.join("; ")}. Existing entries stay active, but no new ones can be added until usage drops below the limit.`,
      );
    }
  }

  // Upgrading ends the current plan immediately. No proration is applied, but
  // the forfeit is recorded on activation so it can be compensated later.
  if (active && action !== SUBSCRIPTION_ACTION.NEW) {
    notices.push(
      `Your current ${current?.name || "plan"} ends immediately when the new plan starts; the remaining ${current?.daysRemaining ?? 0} day(s) are not carried over or refunded.`,
    );
  }

  return {
    config,
    billing,
    active,
    currentPlan,
    action,
    isSideGrade,
    pricing,
    promoVerdict,
    entitlements,
    entitlementsSource,
    entitlementDiff,
    validity: {
      startDate,
      endDate,
      durationInDays: subscription.durationInDays ?? null,
      durationInYears: subscription.durationInYears ?? null,
      durationLabel: formatDuration(
        subscription.durationInDays,
        subscription.durationInYears,
      ),
    },
    canProceed,
    blockedReason,
    notices,

    // ---------------- response shape for the checkout page ----------------
    response: {
      brand: {
        _id: brand._id,
        brandName: brand.brandName,
        isApproved: brand.isApproved,
      },
      plan: {
        _id: subscription._id,
        name: subscription.name,
        description: subscription.description,
        type: subscription.type,
        typeLabel: formatSubscriptionType(subscription.type),
        price: subscription.price,
        strikePrice: subscription.strikePrice ?? null,
        discountType: subscription.discountType,
        discountPercent: subscription.discountPercent ?? 0,
        durationInDays: subscription.durationInDays ?? null,
        durationLabel: formatDuration(
          subscription.durationInDays,
          subscription.durationInYears,
        ),
        benefits: subscription.benefits || [],
        limitations: subscription.limitations || [],
        features: subscription.features || [],
        entitlements,
      },
      action,
      currentPlan: current,
      validity: {
        startDate,
        endDate,
        durationLabel: formatDuration(
          subscription.durationInDays,
          subscription.durationInYears,
        ),
      },
      billingDetails: {
        brandName: billing.brandName,
        address: billing.address,
        gstin: billing.gstin,
        pan: billing.pan,
        addressSource: billing.addressSource,
      },
      pricing,
      orderSummary: buildOrderSummary(pricing, config),
      limits: entitlementDiff.buckets,
      promo: {
        supported: config.isPromoCodeEnabled,
        applied: promoVerdict.ok
          ? {
              code: promoVerdict.promoCode.code,
              description: promoVerdict.promoCode.description || null,
              discount: promoVerdict.discount,
            }
          : null,
        // Null when no code was sent; the specific rejection when one failed.
        message: promoCode
          ? promoVerdict.ok
            ? `Promo code ${promoVerdict.promoCode.code} applied`
            : promoVerdict.reason
          : config.isPromoCodeEnabled
            ? null
            : "Promo codes are coming soon",
      },
      canProceed,
      blockedReason,
      notices,
    },
  };
};
