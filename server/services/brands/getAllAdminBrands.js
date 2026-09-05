const mongoose = require("mongoose");
const Brand = require("../../models/Brand");
const { buildAggregateLookup } = require("../../database");
const { pagination, validateObjectId } = require("../../utils");
const { escapeRegex } = require("../../validator/common");
const {
  BRAND_LIST_SORT_BY,
  BRAND_LIST_SORT_ORDER,
} = require("../../constants/brandStatus");

const MILLISECONDS_PER_DAY = 86400000;

const toBoolean = (value) => value === true || value === "true";

/**
 * Filter for a flag that defaults to **false** (`isApproved`, `isReviewed`, …).
 *
 * Rows created before the flag existed have the field absent, and in Mongo an
 * absent field does not equal `false` — so asking for "false" has to mean "not
 * true", otherwise older brands vanish from the list entirely.
 */
const falseDefaultFilter = (wanted) => (wanted ? true : { $ne: true });

/**
 * Filter for a flag that defaults to **true** (`isActive`).
 *
 * The mirror image of the above: absent means on, so "true" has to mean "not
 * false" rather than a literal match.
 */
const trueDefaultFilter = (wanted) => (wanted ? { $ne: false } : false);

/** A field is "filled in" when it holds anything other than null/absent. */
const isFilled = (field) => ({ $ne: [{ $ifNull: [field, null] }, null] });

/** One entitlement pool as `{ used, limit, isUnlimited }`. */
const pool = (used, limit, unlimited) => ({
  used: { $ifNull: [`$${used}`, 0] },
  limit: { $ifNull: [`$${limit}`, 0] },
  isUnlimited: { $eq: [`$${unlimited}`, true] },
});

/**
 * The admin panel's brand directory — one row per brand, every column an admin
 * screen needs to triage without opening the brand.
 *
 * Its own service rather than a role branch on `getAllCustomerBrands`, for the
 * same reason `getCustomerBrand` is separate from `getBrand`: that pipeline is
 * built to be *safe to show a customer*, and widening it with owner contact
 * details, verification reasons, billing and the deactivation trail would put a
 * projection that strips six sensitive joins one edit away from leaking.
 *
 * Deliberately lighter than `GET /brands/get?brandId=…`. PAN, GSTIN, bank
 * account and the raw KYC scores are per-brand detail — they have no business
 * being fetched a hundred rows at a time — so this carries only *whether* each
 * onboarding step is filled in (`onboarding.hasPan` and friends). The list tells
 * an admin who needs attention; the detail endpoint tells them why.
 *
 * Soft-deleted brands never appear. Deactivated ones always do — they are the
 * rows an admin needs in order to switch them back on.
 */
exports.getAllAdminBrands = async (query = {}) => {
  let {
    page,
    limit,
    search,
    accountActive,
    isActive,
    status,
    isApproved,
    isReviewed,
    isRejected,
    isRevoked,
    isSubscribed,
    isTopBrand,
    categoryId,
    subCategoryId,
    businessEntityType,
    businessRegistrationStatus,
    currentScreen,
    fromDate,
    toDate,
    sortBy,
    sortOrder,
  } = query;

  page = page ? Number(page) : 1;
  limit = limit ? Number(limit) : 10;

  // ── Match ─────────────────────────────────────────────────────────────────
  const match = { isDeleted: false };

  // Customer visibility. The vendor's own account switch is `accountActive`,
  // filtered after the user join below — the two are independent.
  if (isActive !== undefined) {
    match.isActive = trueDefaultFilter(toBoolean(isActive));
  }
  if (status) match.status = status;
  if (isApproved !== undefined) {
    match.isApproved = falseDefaultFilter(toBoolean(isApproved));
  }
  if (isReviewed !== undefined) {
    match.isReviewed = falseDefaultFilter(toBoolean(isReviewed));
  }
  if (isRejected !== undefined) {
    match.isRejected = falseDefaultFilter(toBoolean(isRejected));
  }
  if (isRevoked !== undefined) {
    match.isRevoked = falseDefaultFilter(toBoolean(isRevoked));
  }
  if (isSubscribed !== undefined) {
    match.isSubscribed = falseDefaultFilter(toBoolean(isSubscribed));
  }
  if (isTopBrand !== undefined) {
    match.isTopBrand = falseDefaultFilter(toBoolean(isTopBrand));
  }
  if (categoryId) {
    validateObjectId(categoryId, "Category Id");
    match.categoryId = new mongoose.Types.ObjectId(categoryId);
  }
  if (subCategoryId) {
    validateObjectId(subCategoryId, "Sub Category Id");
    match.subCategoryId = new mongoose.Types.ObjectId(subCategoryId);
  }
  if (businessEntityType) match.businessEntityType = businessEntityType;
  if (businessRegistrationStatus) {
    match.businessRegistrationStatus = businessRegistrationStatus;
  }

  if (fromDate || toDate) {
    match.joinedDate = {};
    if (fromDate) match.joinedDate.$gte = new Date(fromDate);
    if (toDate) {
      const till = new Date(toDate);
      till.setHours(23, 59, 59, 999);
      match.joinedDate.$lte = till;
    }
  }

  // Everything an admin might be handed to find a brand by: the names, the two
  // ids they get told over the phone, and the contact details. All live on Brand
  // itself, so this narrows *before* any join runs.
  if (search?.trim()) {
    const pattern = new RegExp(escapeRegex(search.trim()), "i");
    match.$or = [
      { brandName: pattern },
      { legalBusinessName: pattern },
      { uniqueId: pattern },
      { merchantId: pattern },
      { email: pattern },
      { mobile: pattern },
      { whatsappNumber: pattern },
    ];
  }

  const pipeline = [{ $match: match }];

  // ── Joins ─────────────────────────────────────────────────────────────────
  pipeline.push(
    // The owning vendor. `currentScreen` is the useful one: it says exactly
    // where an unfinished onboarding stopped.
    ...buildAggregateLookup({
      from: "users",
      localField: "userId",
      as: "vendor",
      project: {
        name: 1,
        email: 1,
        mobile: 1,
        whatsappNumber: 1,
        uniqueId: 1,
        role: 1,
        currentScreen: 1,
        isActive: 1,
        isLoggedIn: 1,
        isMobileVerified: 1,
        isSignUpCompleted: 1,
        isOnBoardingCompleted: 1,
        createdAt: 1,
        /**
         * The vendor's own channel toggles, so the directory can show the state
         * without a call per row.
         *
         * ⚠️ Raw, and it is often **absent** — the field only appears once
         * somebody changes a setting, and absent means every channel is on. A
         * client must not read these booleans directly; the resolved answer is
         * on `GET /notifications/admin/preferences`, which also reports whether
         * the platform switch is overriding them.
         */
        notificationPreferences: 1,
      },
    }),
    ...buildAggregateLookup({
      from: "categories",
      localField: "categoryId",
      as: "category",
      project: { name: 1, image: 1 },
    }),
    ...buildAggregateLookup({
      from: "subcategories",
      localField: "subCategoryId",
      as: "subCategory",
      project: { name: 1, image: 1 },
    }),
    // The verdict and the score — never the duplicate-brand id lists, remarks or
    // per-check breakdown SystemVerify also carries. Those are detail-screen
    // material.
    ...buildAggregateLookup({
      from: "systemverifies",
      localField: "systemVerifyId",
      as: "systemVerify",
      project: {
        status: 1,
        score: 1,
        attemptNumber: 1,
        isSuperseded: 1,
        isReviewed: 1,
        isRejected: 1,
        isRevoked: 1,
        isAdminApproved: 1,
      },
    }),
    // The live plan. `Brand.subscribedId` is the denormalised pointer kept in
    // step by helpers/subscribeds/syncBrandSubscriptionState.js.
    ...buildAggregateLookup({
      from: "subscribeds",
      localField: "subscribedId",
      as: "subscribed",
      project: {
        subscriptionId: 1,
        status: 1,
        source: 1,
        startDate: 1,
        endDate: 1,
        paidAmount: 1,
        isFreeGrant: 1,
      },
    }),
    ...buildAggregateLookup({
      from: "subscriptions",
      localField: "subscribed.subscriptionId",
      as: "plan",
      project: { name: 1 },
    }),
  );

  // Live outlet count. The `subBrandsUsed` mirror on the brand is what billing
  // reads; this is what is actually switched on right now, and the two
  // disagreeing is itself worth seeing.
  pipeline.push({
    $lookup: {
      from: "subbrands",
      let: { brandId: "$_id" },
      pipeline: [
        {
          $match: {
            $expr: { $eq: ["$brandId", "$$brandId"] },
            isActive: true,
            isDeleted: false,
          },
        },
        { $project: { _id: 1 } },
      ],
      as: "outlets",
    },
  });

  // These two live on the vendor, so they have to wait for the join above.
  if (currentScreen) {
    pipeline.push({ $match: { "vendor.currentScreen": currentScreen } });
  }
  if (accountActive !== undefined) {
    pipeline.push({
      $match: { "vendor.isActive": trueDefaultFilter(toBoolean(accountActive)) },
    });
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  pipeline.push({
    $addFields: {
      outletCount: { $size: "$outlets" },
      // Which onboarding steps are on file. Presence only — the documents
      // themselves are never joined here.
      onboarding: {
        hasPan: isFilled("$PANId"),
        hasGst: isFilled("$GSTId"),
        hasBank: isFilled("$BankId"),
        hasLocation: isFilled("$locationId"),
        hasWorkHours: isFilled("$workHoursId"),
        hasFirstOutlet: isFilled("$firstSubBrandId"),
        hasSystemVerification: isFilled("$systemVerifyId"),
        hasAcceptedPartnershipDeed: {
          $eq: ["$hasAcceptedPartnershipDeed", true],
        },
      },
      // Four independent pools, each `{ used, limit, isUnlimited }`. Mirrors of
      // the Subscription entitlements, rebuildable via recountBrandUsage.
      usage: {
        subBrands: pool(
          "subBrandsUsed",
          "subBrandsLimit",
          "isSubBrandsUnlimited",
        ),
        franchises: pool(
          "franchisesUsed",
          "franchisesLimit",
          "isFranchisesUnlimited",
        ),
        vouchers: pool("vouchersUsed", "vouchersLimit", "isVouchersUnlimited"),
        showcase: pool("showcaseUsed", "showcaseLimit", "isShowcaseUnlimited"),
      },
      // Whether the vendor can sign in at all. Read off the joined user rather
      // than the brand, because that is where the switch lives — the brand's own
      // `isActive` is customer visibility, a different thing entirely.
      isAccountActive: { $ne: ["$vendor.isActive", false] },
      // When the account was last switched on or off. `accountDeactivatedAt` is
      // cleared on reactivation, so whichever of the two is set is the current
      // state's timestamp; an account never touched falls back to when the brand
      // was created.
      statusChangedAt: {
        $ifNull: [
          "$accountDeactivatedAt",
          { $ifNull: ["$accountActivatedAt", "$createdAt"] },
        ],
      },
    },
  });

  // Flattened plan summary, so the panel reads one object instead of stitching
  // two joins together. `$$NOW` keeps the countdown server-side — a client
  // computing it from its own clock disagrees with the expiry sweep.
  pipeline.push({
    $addFields: {
      subscription: {
        $cond: [
          isFilled("$subscribed._id"),
          {
            subscribedId: "$subscribed._id",
            planId: "$subscribed.subscriptionId",
            planName: "$plan.name",
            status: "$subscribed.status",
            source: "$subscribed.source",
            startDate: "$subscribed.startDate",
            endDate: "$subscribed.endDate",
            paidAmount: "$subscribed.paidAmount",
            isFreeGrant: { $eq: ["$subscribed.isFreeGrant", true] },
            endsInDays: {
              $cond: [
                isFilled("$subscribed.endDate"),
                {
                  $ceil: {
                    $divide: [
                      { $subtract: ["$subscribed.endDate", "$$NOW"] },
                      MILLISECONDS_PER_DAY,
                    ],
                  },
                },
                null,
              ],
            },
          },
          null,
        ],
      },
    },
  });

  // ── Sort ──────────────────────────────────────────────────────────────────
  // NEWEST / OLDEST are directions in themselves and ignore `sortOrder`; the
  // rest take it, falling back to the only ordering that makes sense for that
  // column (names A→Z, counts and dates biggest/soonest first).
  const direction = (fallback) => {
    if (sortOrder === BRAND_LIST_SORT_ORDER.ASC) return 1;
    if (sortOrder === BRAND_LIST_SORT_ORDER.DESC) return -1;
    return fallback;
  };

  let sortStage;
  switch (sortBy) {
    case BRAND_LIST_SORT_BY.OLDEST:
      sortStage = { joinedDate: 1 };
      break;
    case BRAND_LIST_SORT_BY.NAME:
      sortStage = { brandName: direction(1) };
      break;
    case BRAND_LIST_SORT_BY.FOLLOWERS:
      sortStage = { followersCount: direction(-1) };
      break;
    case BRAND_LIST_SORT_BY.VOUCHERS:
      sortStage = { vouchersUsed: direction(-1) };
      break;
    case BRAND_LIST_SORT_BY.OUTLETS:
      sortStage = { outletCount: direction(-1) };
      break;
    case BRAND_LIST_SORT_BY.SUBSCRIPTION_END:
      sortStage = { "subscription.endDate": direction(1) };
      break;
    case BRAND_LIST_SORT_BY.STATUS_CHANGED:
      sortStage = { statusChangedAt: direction(-1) };
      break;
    case BRAND_LIST_SORT_BY.NEWEST:
    default:
      sortStage = { joinedDate: -1 };
  }
  // Without a unique tiebreak, ties page unpredictably — the same brand can
  // appear on two pages while another never appears at all.
  sortStage._id = -1;

  pipeline.push({ $sort: sortStage });

  // ── Shape ─────────────────────────────────────────────────────────────────
  // An allow-list, not `{ __v: 0 }`. Every field an admin screen reads is named
  // here, so a field added to Brand later cannot start being served by accident.
  pipeline.push({
    $project: {
      // identity
      brandName: 1,
      legalBusinessName: 1,
      uniqueId: 1,
      merchantId: 1,
      logo: 1,
      coverImage: 1,
      description: 1,
      email: 1,
      mobile: 1,
      whatsappNumber: 1,
      businessEntityType: 1,
      businessRegistrationStatus: 1,
      joinedDate: 1,
      createdAt: 1,
      updatedAt: 1,

      // owner + taxonomy
      vendor: 1,
      category: 1,
      subCategory: 1,

      // verification, as mirrored on the brand …
      status: 1,
      isApproved: 1,
      isReviewed: 1,
      isRejected: 1,
      isRevoked: 1,
      rejectionReason: 1,
      revokeReason: 1,
      verifiedBy: 1,
      verifiedAt: 1,
      reviewedAt: 1,
      approvedAt: 1,
      rejectedAt: 1,
      revokedAt: 1,
      reviewedByAdminId: 1,
      approvedByAdminId: 1,
      rejectedByAdminId: 1,
      revokedByAdminId: 1,
      verificationAttemptCount: 1,
      isApprovalAcknowledged: 1,
      // … and the score behind it
      systemVerify: 1,

      // onboarding progress
      onboarding: 1,

      // plan + entitlements
      isSubscribed: 1,
      subscription: 1,
      usage: 1,

      // engagement
      followersCount: 1,
      avoidanceCount: 1,
      outletCount: 1,

      // curation
      isTopBrand: 1,
      topOrder: 1,
      topAddedAt: 1,

      // ── the two switches this list also drives ──
      // The vendor's account: can they sign in and make changes.
      isAccountActive: 1,
      statusChangedAt: 1,
      accountDeactivatedAt: 1,
      accountDeactivatedByAdminId: 1,
      accountDeactivationReason: 1,
      accountActivatedAt: 1,
      accountActivatedByAdminId: 1,
      // Customer visibility: is the brand served to the customer app. Named
      // `isActive` on the document; aliased here so a reader of the response
      // cannot mistake it for the account switch above.
      isVisibleToCustomers: { $ne: ["$isActive", false] },
      customerVisibilityUpdatedAt: 1,
      customerVisibilityUpdatedByAdminId: 1,
    },
  });

  return pagination(Brand, pipeline, page, limit, "brand");
};
