const mongoose = require("mongoose");

const Customer = require("../../models/Customer");
const User = require("../../models/User");
const VoucherClaim = require("../../models/VoucherClaim");
const RefundRequest = require("../../models/RefundRequest");
const Follow = require("../../models/Follow");
const BrandAvoidance = require("../../models/BrandAvoidance");
const PromoCodeUsage = require("../../models/PromoCodeUsage");
const Location = require("../../models/Location");
const CustomerBankAccount = require("../../models/CustomerBankAccount");
const DeviceToken = require("../../models/DeviceToken");

const { buildAggregateLookup } = require("../../database");
const { throwError } = require("../../utils");
const { ROLES } = require("../../constants");
const {
  getCustomerStats,
  round2,
  SPENDING_STATUSES,
} = require("../../helpers/customers");
const {
  assertRefundAllowance,
  COUNTS_AGAINST_ALLOWANCE,
  refundProjection,
  presentRefund,
} = require("../../helpers/refunds");
const { getCustomerConfig } = require("../../helpers/settings");
const { present: presentBankAccount } = require("../customerBankAccounts");
const {
  PROMO_AUDIENCE,
  PROMO_USAGE_STATUS,
} = require("../../constants/promoCode");
const {
  CUSTOMER_DETAIL_LIMITS,
  REFUND_BLOCK_REASON,
} = require("../../constants/customerList");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `#TC64840`, with or without the `#`.
 *
 * The `#` has to be percent-encoded to survive a URL, and an admin pasting an id
 * out of a support conversation will not do that — the browser reads everything
 * from `#` on as a fragment and the server never sees it, which arrives as a
 * confusing 404 on a route that looks correct. So the bare `TC64840` form is
 * accepted too and normalised back.
 */
const CUSTOMER_UNIQUE_ID = /^#?TC\d+$/i;

const asUniqueId = (raw) => {
  const upper = raw.toUpperCase();
  return upper.startsWith("#") ? upper : `#${upper}`;
};

/**
 * Everything an admin may read off the account, named one by one.
 *
 * An allow-list rather than `-password -otp`: the deny-list has to be updated
 * every time somebody adds a secret to `User`, and forgetting produces no error
 * — just a field in a response nobody looks at until it matters.
 *
 * `meta` and `sessionInvalidatedAt` are here and deliberately not on the
 * directory: an IP address and a device id are what a fraud investigation needs
 * on one named account, and are nobody's business a hundred rows at a time.
 */
const ACCOUNT_FIELDS = [
  "name",
  "email",
  "mobile",
  "whatsappNumber",
  "username",
  "uniqueId",
  "role",
  "loginType",
  "image",
  "dob",
  "currentScreen",
  "walletBalance",
  "tCoinsBalance",
  "referralCode",
  "appliedReferralCode",
  "referralCount",
  "followerCount",
  "followingCount",
  "reviewCount",
  "meta",
  "isActive",
  "isOnline",
  "isLoggedIn",
  "isEmailVerified",
  "isMobileVerified",
  "isSignUpCompleted",
  "isOnBoardingCompleted",
  "isDeleted",
  // Whether they ever chose a password, and when every open session was killed.
  // Never the password itself.
  "passwordSetAt",
  "sessionInvalidatedAt",
  "createdAt",
  "updatedAt",
].join(" ");

/**
 * Where this customer's money actually goes.
 *
 * Grouped from the claims rather than the transactions, because the claim
 * carries the frozen `pricing` block and the brand id on the same row — a
 * transaction would need the claim joined back to say which brand it was.
 */
const spendByBrand = (customerId) =>
  VoucherClaim.aggregate([
    {
      $match: {
        customerId,
        isDeleted: false,
        status: { $in: SPENDING_STATUSES },
      },
    },
    {
      $group: {
        _id: "$brandId",
        claims: { $sum: 1 },
        spend: { $sum: { $ifNull: ["$pricing.totalPayable", 0] } },
        saved: { $sum: { $ifNull: ["$pricing.youSaved", 0] } },
        lastClaimAt: { $max: "$createdAt" },
      },
    },
    { $sort: { spend: -1, _id: -1 } },
    { $limit: CUSTOMER_DETAIL_LIMITS.TOP_BRANDS },
    ...buildAggregateLookup({
      from: "brands",
      localField: "_id",
      as: "brand",
      project: { brandName: 1, logo: 1, uniqueId: 1 },
    }),
    {
      $project: {
        _id: 0,
        brandId: "$_id",
        brandName: "$brand.brandName",
        brandUniqueId: "$brand.uniqueId",
        logo: "$brand.logo",
        claims: 1,
        spend: 1,
        saved: 1,
        lastClaimAt: 1,
      },
    },
  ]);

/**
 * The order history, newest first.
 *
 * Reads the **snapshots**, not the live brand and outlet. A claim from September
 * has to still name the brand it was bought from even after a rename, and that
 * is the entire reason those snapshots exist. The pricing block is reduced to
 * the two figures a support conversation needs — the rest of it, including our
 * margin and the promo cost split, is claim-detail material.
 */
const recentClaims = (customerId, limit) =>
  VoucherClaim.aggregate([
    { $match: { customerId, isDeleted: false } },
    { $sort: { createdAt: -1, _id: -1 } },
    { $limit: limit },
    {
      $project: {
        claimCode: 1,
        status: 1,
        redemptionMode: 1,
        brandId: 1,
        subBrandId: 1,
        voucherId: 1,
        transactionId: 1,
        brandName: "$brandSnapshot.name",
        voucherName: "$voucherSnapshot.name",
        outletUniqueId: "$outletSnapshot.uniqueId",
        outletState: "$outletSnapshot.state",
        billAmount: 1,
        offerApplied: 1,
        totalPayable: "$pricing.totalPayable",
        youSaved: "$pricing.youSaved",
        promoCode: 1,
        promoDiscount: 1,
        createdAt: 1,
        paidAt: 1,
        redeemedAt: 1,
        cancelledAt: 1,
        expiresAt: 1,
        refundedAt: 1,
        refundAmount: 1,
      },
    },
  ]);

/**
 * Their refund history, through the **admin** projection.
 *
 * `refundProjection` and `presentRefund` rather than a projection written here,
 * so this screen and `GET /refunds` cannot disagree about what an admin sees —
 * the `split` block carries our promo share and the MDR we swallow, which is
 * exactly the kind of thing that gets copied to a new surface and then quietly
 * widened.
 */
const recentRefunds = async (customerId, limit) => {
  const rows = await RefundRequest.aggregate([
    { $match: { customerId, isDeleted: false } },
    { $sort: { createdAt: -1, _id: -1 } },
    { $limit: limit },
    { $project: refundProjection(ROLES.ADMIN) },
  ]);
  return rows.map((row) => presentRefund(row, ROLES.ADMIN));
};

/**
 * Brands they follow, or brands they have asked never to see. Same shape, two
 * collections that name their columns differently — `Follow` keys the customer
 * as `followerId` and the brand as `followeeId`, `BrandAvoidance` uses
 * `customerId` and `brandId` — so both are passed in rather than inferred.
 */
const brandRelations = (Model, { ownerField, brandField }, customerId, limit) =>
  Model.aggregate([
    { $match: { [ownerField]: customerId, isDeleted: false } },
    { $sort: { createdAt: -1, _id: -1 } },
    { $limit: limit },
    ...buildAggregateLookup({
      from: "brands",
      localField: brandField,
      as: "brand",
      project: { brandName: 1, logo: 1, uniqueId: 1, isActive: 1 },
    }),
    {
      $project: {
        _id: 0,
        brandId: "$brand._id",
        brandName: "$brand.brandName",
        brandUniqueId: "$brand.uniqueId",
        logo: "$brand.logo",
        since: "$createdAt",
      },
    },
  ]);

/** Promo codes they have actually spent, newest first. */
const recentPromoUsage = (customerId, limit) =>
  PromoCodeUsage.aggregate([
    {
      $match: {
        customerId,
        audience: PROMO_AUDIENCE.CUSTOMER,
        status: PROMO_USAGE_STATUS.CONSUMED,
      },
    },
    { $sort: { consumedAt: -1, _id: -1 } },
    { $limit: limit },
    ...buildAggregateLookup({
      from: "promocodes",
      localField: "promoCodeId",
      as: "promo",
      project: { code: 1, description: 1 },
    }),
    {
      $project: {
        _id: 0,
        promoCodeId: 1,
        code: "$promo.code",
        description: "$promo.description",
        discountAmount: 1,
        vendorCost: 1,
        platformCost: 1,
        voucherClaimId: 1,
        consumedAt: 1,
      },
    },
  ]);

/**
 * Can this customer open another refund right now — and if not, why.
 *
 * ### Why this calls the assertion rather than re-deriving the rule
 *
 * `assertRefundAllowance` is what the customer actually hits. Reimplementing its
 * two conditions here would give an admin a screen that says "yes" while the
 * customer is being refused, and a support conversation where both people are
 * looking at correct-looking information and disagreeing. Running the real check
 * makes that impossible, and hands back **the exact sentence the customer saw**,
 * which is usually the thing they are quoting down the phone.
 *
 * ⚠️ Only a 422 is treated as a verdict. Anything else — a dropped connection, a
 * bad config — is re-thrown, because reporting a database failure as "this
 * customer is blocked" would put a false accusation on a support screen.
 */
const refundAllowance = async (customerId, config) => {
  const maxOpen = Number(config.maxOpenRequests) || 0;
  const maxRefused = Number(config.maxRejectedPerWindow) || 0;
  const windowDays = Number(config.requestWindowDays) || 0;
  const windowStartedAt = windowDays
    ? new Date(Date.now() - windowDays * DAY_MS)
    : null;

  const [openRequests, refusedInWindow] = await Promise.all([
    RefundRequest.countDocuments({ customerId, isOpen: true, isDeleted: false }),
    windowStartedAt
      ? RefundRequest.countDocuments({
          customerId,
          status: { $in: COUNTS_AGAINST_ALLOWANCE },
          createdAt: { $gte: windowStartedAt },
          isDeleted: false,
        })
      : 0,
  ]);

  let canRequest = true;
  let blockedReason = null;
  let customerFacingMessage = null;

  try {
    await assertRefundAllowance({ customerId, config });
  } catch (error) {
    if (error?.statusCode !== 422) throw error;
    canRequest = false;
    customerFacingMessage = error.message;
    // Which limit bit. The message deliberately does not say — it is written for
    // the customer and points them at support — but the two lead an admin to
    // completely different next steps.
    blockedReason =
      maxOpen > 0 && openRequests >= maxOpen
        ? REFUND_BLOCK_REASON.OPEN_LIMIT_REACHED
        : REFUND_BLOCK_REASON.REFUSAL_LIMIT_REACHED;
  }

  return {
    canRequest,
    blockedReason,
    // Verbatim, so an admin can match it against what the customer is reading.
    customerFacingMessage,
    openRequests,
    refusedInWindow,
    windowStartedAt,
    limits: {
      maxOpenRequests: maxOpen,
      maxRejectedPerWindow: maxRefused,
      requestWindowDays: windowDays,
    },
  };
};

/**
 * Who brought them in, and who they have brought in.
 *
 * The referral graph is the one place a customer detail screen earns its keep
 * for fraud: a run of accounts all carrying one referral code, created minutes
 * apart, is a person farming their own bonus, and no single account looks wrong
 * on its own.
 *
 * `referralCount` on the account is the denormalised counter and is reported as
 * given; `referredCount` is what the collection actually holds. The two
 * disagreeing is itself worth seeing.
 */
const EMPTY_REFERRALS = {
  referralCode: null,
  appliedReferralCode: null,
  referredBy: null,
  referralCountOnAccount: 0,
  referredCount: 0,
  referred: [],
};

const referralGraph = async (account, limit) => {
  // A customer with no account at all — the residue of a half-finished signup —
  // still gets every key. Returning a shorter object here would make the two
  // fields that went missing the only ones on the whole response a reader has to
  // null-check, and only for the rarest customer, which is exactly the shape of
  // bug nobody hits until production.
  if (!account) return { ...EMPTY_REFERRALS };

  const [referredBy, referred, referredCount] = await Promise.all([
    account.appliedReferralCode
      ? User.findOne({
          referralCode: account.appliedReferralCode,
          isDeleted: false,
        })
          .select("name uniqueId role image referralCode createdAt")
          .lean()
      : null,
    account.referralCode
      ? User.find({
          appliedReferralCode: account.referralCode,
          isDeleted: false,
        })
          .select("name uniqueId role image customerId isActive createdAt")
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean()
      : [],
    account.referralCode
      ? User.countDocuments({
          appliedReferralCode: account.referralCode,
          isDeleted: false,
        })
      : 0,
  ]);

  return {
    referralCode: account.referralCode || null,
    appliedReferralCode: account.appliedReferralCode || null,
    referredBy: referredBy || null,
    // What the counter on the account claims.
    referralCountOnAccount: account.referralCount ?? 0,
    // What the users collection actually holds.
    referredCount,
    referred,
  };
};

/** `{ total, data }` — the shape every sub-list here reports. */
const block = (total, data) => ({ total, data });

/**
 * One customer, everything an admin needs to answer a support conversation
 * without opening five other screens.
 *
 * ### Openable by id **or** by `#TC` number
 *
 * The `#TC64840` is what exists in the real world: it is what a customer reads
 * out and what support pastes into a ticket. A surface that only took an
 * ObjectId would force an admin to search the directory first, which is a second
 * round trip to reach a page they already know the address of. Both forms 404
 * identically on a miss, so a guessed id tells a prober nothing.
 *
 * ### Deleted and deactivated customers open
 *
 * Deliberately no `isDeleted: false`. The directory filters them out — that list
 * is a worklist of live customers — but "where did this account go?" is one of
 * the most common things support is asked, and answering it with a 404 tells an
 * admin the id is wrong rather than that the account was closed. The flags are
 * on the response and the money, refunds and open disputes are all still there,
 * which is the whole point: a closed account can still have a refund owed on it.
 */
exports.getAdminCustomerDetail = async (key, query = {}) => {
  const raw = String(key || "").trim();
  if (!raw) throwError(400, "Customer id is required.");

  // The `#TC` form is checked **first**: `ObjectId.isValid` returns true for any
  // 12-character string, so a unique id that happened to be twelve characters
  // long would otherwise be read as an id and looked up in the wrong field.
  let lookup;
  if (CUSTOMER_UNIQUE_ID.test(raw)) lookup = { uniqueId: asUniqueId(raw) };
  else if (mongoose.Types.ObjectId.isValid(raw)) {
    lookup = { _id: new mongoose.Types.ObjectId(raw) };
  } else throwError(422, "Invalid customer id.");

  const customer = await Customer.findOne(lookup).lean();
  if (!customer) throwError(404, "Customer not found.");

  const limit = Math.min(
    Number(query.recentLimit) || CUSTOMER_DETAIL_LIMITS.DEFAULT_RECENT,
    CUSTOMER_DETAIL_LIMITS.MAX_RECENT,
  );

  const customerId = customer._id;
  const userId = customer.userId || null;

  // The account has to be in hand before the referral graph runs — that one
  // reads the codes off it — so it is fetched ahead of the main batch. The
  // settings read has no such dependency, so it goes alongside rather than after:
  // two round trips before the batch, not three.
  const [account, customerConfig] = await Promise.all([
    userId ? User.findById(userId).select(ACCOUNT_FIELDS).lean() : null,
    getCustomerConfig(),
  ]);

  const refundConfig = customerConfig.refund || {};

  const [
    stats,
    brands,
    claims,
    claimTotal,
    refunds,
    refundTotal,
    addresses,
    addressTotal,
    bankAccounts,
    devices,
    following,
    followingTotal,
    avoiding,
    avoidingTotal,
    promoUsage,
    promoTotal,
    allowance,
    referrals,
  ] = await Promise.all([
    // The same nine aggregations the directory runs, through the same helper —
    // a row in the list and this page must never disagree about a customer's
    // money.
    getCustomerStats(customerId, userId),
    spendByBrand(customerId),
    recentClaims(customerId, limit),
    VoucherClaim.countDocuments({ customerId, isDeleted: false }),
    recentRefunds(customerId, limit),
    RefundRequest.countDocuments({ customerId, isDeleted: false }),
    // `isActive: true` as well as `isDeleted: false`, matching what
    // `collectCustomerStats` counts — otherwise `addresses.total` here and
    // `stats.profile.addressCount` above would report different numbers for the
    // same customer on the same screen.
    Location.find({ customerId, isActive: true, isDeleted: false })
      .sort({ isDefault: -1, updatedAt: -1 })
      .limit(limit)
      .lean(),
    Location.countDocuments({ customerId, isActive: true, isDeleted: false }),
    // Masked through the same `present()` the customer's own screen uses, so the
    // raw account number cannot leak from one surface after being hidden on the
    // other. `verificationResponse` never leaves the database.
    CustomerBankAccount.find({ customerId, isDeleted: false })
      .sort({ createdAt: -1 })
      .lean(),
    // Not capped, deliberately: a person carries a handful of devices, and the
    // count is what `stats.profile.activeDeviceCount` already reports — a capped
    // list here would make `devices.total` disagree with it.
    userId
      ? DeviceToken.find({ userId, isActive: true })
          .select(
            "platform deviceName appVersion lastSeenAt lastPushAt failureCount createdAt",
          )
          .sort({ lastSeenAt: -1 })
          .lean()
      : [],
    brandRelations(
      Follow,
      { ownerField: "followerId", brandField: "followeeId" },
      customerId,
      limit,
    ),
    Follow.countDocuments({ followerId: customerId, isDeleted: false }),
    brandRelations(
      BrandAvoidance,
      { ownerField: "customerId", brandField: "brandId" },
      customerId,
      limit,
    ),
    BrandAvoidance.countDocuments({ customerId, isDeleted: false }),
    recentPromoUsage(customerId, limit),
    PromoCodeUsage.countDocuments({
      customerId,
      audience: PROMO_AUDIENCE.CUSTOMER,
      status: PROMO_USAGE_STATUS.CONSUMED,
    }),
    refundAllowance(customerId, refundConfig),
    referralGraph(account, limit),
  ]);

  return {
    customer: {
      _id: customer._id,
      fullName: customer.fullName || null,
      uniqueId: customer.uniqueId,
      email: customer.email || null,
      mobile: customer.mobile || null,
      whatsappNumber: customer.whatsappNumber || null,
      image: customer.image || null,
      dob: customer.dob || null,
      userId,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    },
    account,

    /**
     * Two independent switches and a soft delete, stated separately.
     *
     * `isAccountActive` is `User.isActive` — whether this person can sign in at
     * all. `isProfileActive` is `Customer.isActive` on the profile row. Nothing
     * keeps them in step, so collapsing them into one "active" would hide
     * exactly the state an admin opened this page to understand.
     *
     * `hasAccount: false` is the residue of a half-finished signup that
     * `repairRoleProfile` has not seen yet — a real state, and one that explains
     * why this customer can do nothing at all.
     */
    status: {
      hasAccount: Boolean(account),
      isAccountActive: account ? account.isActive !== false : false,
      isProfileActive: customer.isActive !== false,
      isDeleted: customer.isDeleted === true,
      isAccountDeleted: account ? account.isDeleted === true : null,
      isSignUpCompleted: customer.isSignUpCompleted === true,
      isOnBoardingCompleted: account?.isOnBoardingCompleted === true,
      isLoggedIn: account?.isLoggedIn === true,
      hasPassword: Boolean(account?.passwordSetAt),
      sessionInvalidatedAt: account?.sessionInvalidatedAt || null,
      currentScreen: account?.currentScreen || null,
    },

    // The five blocks the directory shows, identical figures.
    stats,

    balances: {
      wallet: round2(account?.walletBalance),
      tCoins: round2(account?.tCoinsBalance),
    },

    spendByBrand: brands,
    referrals,
    refundAllowance: allowance,

    recentClaims: block(claimTotal, claims),
    recentRefunds: block(refundTotal, refunds),
    addresses: block(addressTotal, addresses),
    bankAccounts: block(bankAccounts.length, bankAccounts.map(presentBankAccount)),
    devices: block(devices.length, devices),
    following: block(followingTotal, following),
    avoiding: block(avoidingTotal, avoiding),
    promoUsage: block(promoTotal, promoUsage),
  };
};
