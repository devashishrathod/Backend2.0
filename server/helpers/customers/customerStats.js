const VoucherClaim = require("../../models/VoucherClaim");
const RefundRequest = require("../../models/RefundRequest");
const Transaction = require("../../models/Transaction");
const Follow = require("../../models/Follow");
const BrandAvoidance = require("../../models/BrandAvoidance");
const PromoCodeUsage = require("../../models/PromoCodeUsage");
const Location = require("../../models/Location");
const CustomerBankAccount = require("../../models/CustomerBankAccount");
const DeviceToken = require("../../models/DeviceToken");

/**
 * ⚠️ The leaf module, never `require("../transactions")`.
 *
 * This file is loaded from `helpers/customers/index.js`, and the transactions
 * **barrel** pulls in `assertTransactionAccess`, which destructures
 * `resolveCustomerId` back out of that same barrel. Going through the barrel
 * closes the loop: `helpers/customers/index.js` has not assigned its exports
 * yet, so `assertTransactionAccess` binds `resolveCustomerId` to `undefined` —
 * permanently, for the life of the process.
 *
 * Node warns and carries on, so nothing fails at boot. It fails much later, on
 * the first customer who opens a payment or a claim, as a bare "not a function"
 * from a file nobody changed. `buildTransactionFilter.js` requires only `utils`
 * and the transaction constants, so importing it directly has no such loop.
 */
const {
  buildTransactionFilter,
} = require("../transactions/buildTransactionFilter");
const { VOUCHER_CLAIM_STATUS } = require("../../constants/voucherClaim");
const { REFUND_REQUEST_STATUS } = require("../../constants/refund");
const { TRANSACTION_PURPOSE } = require("../../constants/transaction");
const {
  PROMO_AUDIENCE,
  PROMO_USAGE_STATUS,
} = require("../../constants/promoCode");

/**
 * What one customer is worth, has asked back, and is connected to.
 *
 * ### Why this is a helper and not part of the list service
 *
 * Two admin surfaces read these numbers — the directory (`getAllAdminCustomers`)
 * and the detail screen (`getAdminCustomerDetail`) — and they are read side by
 * side: an admin scans the list, sees a lifetime spend, clicks the row, and
 * expects the same figure on the page that opens. Two definitions would drift
 * the first time one of them learned about a new claim status, and the symptom
 * is a row and a page disagreeing about a customer's money with nothing raising
 * an error. One definition, one place, exactly like `presentRefund` and
 * `calculateVoucherPricing`.
 *
 * ### Everything here is batched by id, deliberately
 *
 * `collectCustomerStats` takes **arrays** even when the caller has one customer.
 * `pagination` appends its `$facet` at the end of whatever pipeline it is given,
 * so a `$lookup` written into the list's pipeline would run for every document
 * that matched the filter, on every page request — across what will be the
 * largest collection this platform holds. Fetching by `{ $in: pageIds }`
 * afterwards keeps that cost tied to the page instead, and gives the detail
 * screen the identical code path for its single id.
 */

/** Rupees, to the paisa. Floating-point sums drift otherwise. */
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/** `$sum` of 1 for every row matching an expression. */
const countIf = (expr) => ({ $sum: { $cond: [expr, 1, 0] } });

/**
 * `$sum` of a money field, but only for rows matching an expression.
 *
 * `$ifNull` is not decoration: these are optional paths, and an absent one makes
 * the whole `$sum` `null` rather than skipping the row.
 */
const sumIf = (expr, field) => ({
  $sum: { $cond: [expr, { $ifNull: [field, 0] }, 0] },
});

const isStatus = (status) => ({ $eq: ["$status", status] });
const inStatuses = (statuses) => ({ $in: ["$status", statuses] });

/**
 * A claim whose money is currently ours to account for.
 *
 * `REFUNDED` is deliberately absent — a fully refunded claim moves to that
 * status, so it drops out on its own. A **partially** refunded one stays `PAID`
 * or `REDEEMED` and is counted at full value here; the refunded portion is
 * reported beside it and netted off in `netSpend`, the same way `computeTotals`
 * nets a partial refund rather than excluding the payment.
 */
const SPENDING_STATUSES = [
  VOUCHER_CLAIM_STATUS.PAID,
  VOUCHER_CLAIM_STATUS.REDEEMED,
];

/**
 * Requests that ended in a refusal.
 *
 * The same three `COUNTS_AGAINST_ALLOWANCE` uses, and for the same reason:
 * `CANCELLED` belongs with the rejections because raise → vendor sees it →
 * withdraw → raise again is a way to keep a vendor busy without ever collecting
 * a rejection. `VENDOR_TIMEOUT` is **not** here — nobody refused anything, the
 * vendor simply did not answer, and holding that against the customer would
 * punish them for the vendor's silence.
 */
const REFUSED_STATUSES = [
  REFUND_REQUEST_STATUS.VENDOR_REJECTED,
  REFUND_REQUEST_STATUS.ADMIN_REJECTED,
  REFUND_REQUEST_STATUS.CANCELLED,
];

const EMPTY_CLAIMS = {
  totalClaims: 0,
  pendingClaims: 0,
  paidClaims: 0,
  redeemedClaims: 0,
  failedClaims: 0,
  cancelledClaims: 0,
  expiredClaims: 0,
  refundedClaims: 0,
  totalBilled: 0,
  grossSpend: 0,
  totalSaved: 0,
  firstClaimAt: null,
  lastClaimAt: null,
  lastPaidAt: null,
};

const claimStats = (customerIds) =>
  VoucherClaim.aggregate([
    { $match: { customerId: { $in: customerIds }, isDeleted: false } },
    {
      $group: {
        _id: "$customerId",
        totalClaims: { $sum: 1 },
        pendingClaims: countIf(isStatus(VOUCHER_CLAIM_STATUS.PENDING)),
        paidClaims: countIf(isStatus(VOUCHER_CLAIM_STATUS.PAID)),
        redeemedClaims: countIf(isStatus(VOUCHER_CLAIM_STATUS.REDEEMED)),
        failedClaims: countIf(isStatus(VOUCHER_CLAIM_STATUS.FAILED)),
        cancelledClaims: countIf(isStatus(VOUCHER_CLAIM_STATUS.CANCELLED)),
        expiredClaims: countIf(isStatus(VOUCHER_CLAIM_STATUS.EXPIRED)),
        refundedClaims: countIf(isStatus(VOUCHER_CLAIM_STATUS.REFUNDED)),
        // What they rang up at the counter, before any discount.
        totalBilled: sumIf(inStatuses(SPENDING_STATUSES), "$billAmount"),
        // What they actually paid us. Read off the frozen `pricing` block, not
        // recomputed — the live settings behind it move.
        grossSpend: sumIf(
          inStatuses(SPENDING_STATUSES),
          "$pricing.totalPayable",
        ),
        totalSaved: sumIf(inStatuses(SPENDING_STATUSES), "$pricing.youSaved"),
        firstClaimAt: { $min: "$createdAt" },
        lastClaimAt: { $max: "$createdAt" },
        lastPaidAt: { $max: "$paidAt" },
      },
    },
  ]);

const EMPTY_REFUNDS = {
  totalRequests: 0,
  openRequests: 0,
  completedRequests: 0,
  refusedRequests: 0,
  failedRequests: 0,
  awaitingBankDetails: 0,
  refundedAmount: 0,
  lastRequestAt: null,
};

const refundStats = (customerIds) =>
  RefundRequest.aggregate([
    { $match: { customerId: { $in: customerIds }, isDeleted: false } },
    {
      $group: {
        _id: "$customerId",
        totalRequests: { $sum: 1 },
        // `isOpen` rather than a status list: it is the denormalised boolean the
        // one-open-request-per-payment index is built on, so it cannot disagree
        // with what the write path enforces.
        openRequests: countIf({ $eq: ["$isOpen", true] }),
        completedRequests: countIf(isStatus(REFUND_REQUEST_STATUS.COMPLETED)),
        refusedRequests: countIf(inStatuses(REFUSED_STATUSES)),
        failedRequests: countIf(isStatus(REFUND_REQUEST_STATUS.FAILED)),
        // Waiting on the customer, not on us — an admin can do nothing here.
        awaitingBankDetails: countIf(
          isStatus(REFUND_REQUEST_STATUS.AWAITING_BANK_DETAILS),
        ),
        // Only money that actually left. `split.totalRefund` is the frozen
        // figure the customer was paid, not what they asked for.
        refundedAmount: sumIf(
          isStatus(REFUND_REQUEST_STATUS.COMPLETED),
          "$split.totalRefund",
        ),
        lastRequestAt: { $max: "$createdAt" },
      },
    },
  ]);

const EMPTY_DISPUTES = {
  disputedPayments: 0,
  disputedAmount: 0,
  lastDisputedAt: null,
};

/**
 * Chargebacks this customer raised with their bank.
 *
 * Through `buildTransactionFilter` because `transactions` holds both money
 * flows: without the `purpose`, a customer's chargeback count would silently
 * include vendor subscription rows. The `$in` is added on top rather than passed
 * through the helper, which takes a single id — the guarantee the helper exists
 * for (`purpose` present, `isDeleted: false`) is unaffected.
 */
const disputeStats = (customerIds) =>
  Transaction.aggregate([
    {
      $match: {
        ...buildTransactionFilter({
          purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM,
        }),
        customerId: { $in: customerIds },
        isDisputed: true,
      },
    },
    {
      $group: {
        _id: "$customerId",
        disputedPayments: { $sum: 1 },
        disputedAmount: { $sum: { $ifNull: ["$disputeAmount", 0] } },
        lastDisputedAt: { $max: "$disputedAt" },
      },
    },
  ]);

const followStats = (customerIds) =>
  Follow.aggregate([
    { $match: { followerId: { $in: customerIds }, isDeleted: false } },
    { $group: { _id: "$followerId", followingCount: { $sum: 1 } } },
  ]);

const avoidanceStats = (customerIds) =>
  BrandAvoidance.aggregate([
    { $match: { customerId: { $in: customerIds }, isDeleted: false } },
    { $group: { _id: "$customerId", avoidedBrandsCount: { $sum: 1 } } },
  ]);

const EMPTY_PROMO = {
  promoRedemptions: 0,
  promoDiscountAvailed: 0,
  promoReservationsOpen: 0,
};

/**
 * ⚠️ `$eq: CUSTOMER`, and only here.
 *
 * The vendor side of this collection has to match with `$ne: CUSTOMER`, because
 * rows written before `audience` existed carry no value and are all vendor rows.
 * The customer side is the opposite: an absent `audience` is never a customer
 * redemption, so an equality match is both correct and the one that uses the
 * index.
 */
const promoStats = (customerIds) =>
  PromoCodeUsage.aggregate([
    {
      $match: {
        customerId: { $in: customerIds },
        audience: PROMO_AUDIENCE.CUSTOMER,
      },
    },
    {
      $group: {
        _id: "$customerId",
        promoRedemptions: countIf(isStatus(PROMO_USAGE_STATUS.CONSUMED)),
        promoDiscountAvailed: sumIf(
          isStatus(PROMO_USAGE_STATUS.CONSUMED),
          "$discountAmount",
        ),
        // A reservation still open is a checkout in flight, or one the sweep has
        // not reclaimed yet. Worth seeing next to the redemptions.
        promoReservationsOpen: countIf(isStatus(PROMO_USAGE_STATUS.RESERVED)),
      },
    },
  ]);

/**
 * The address book, and the one address that represents the customer.
 *
 * `isDefault` first, then most recently touched — so a customer who never marked
 * a default still gets the address they actually use rather than an arbitrary
 * one.
 */
const locationStats = (customerIds) =>
  Location.aggregate([
    {
      $match: {
        customerId: { $in: customerIds },
        isActive: true,
        isDeleted: false,
      },
    },
    { $sort: { isDefault: -1, updatedAt: -1 } },
    {
      $group: {
        _id: "$customerId",
        addressCount: { $sum: 1 },
        primaryAddress: {
          $first: {
            city: "$city",
            district: "$district",
            state: "$state",
            country: "$country",
            zipcode: "$zipcode",
            addressType: "$addressType",
            formattedAddress: "$formattedAddress",
            isDefault: { $eq: ["$isDefault", true] },
          },
        },
      },
    },
  ]);

/**
 * Whether a refund that cannot go back to source has somewhere to land.
 *
 * Counts only — never the account number, not even the masked one. The detail
 * screen returns the masked rows through `present()`; a directory of a hundred
 * customers has no business carrying anybody's bank details at all.
 */
const bankStats = (customerIds) =>
  CustomerBankAccount.aggregate([
    { $match: { customerId: { $in: customerIds }, isDeleted: false } },
    {
      $group: {
        _id: "$customerId",
        bankAccountCount: { $sum: 1 },
        verifiedBankAccountCount: countIf({ $eq: ["$isVerified", true] }),
      },
    },
  ]);

/**
 * Push reach. Keyed on `userId` — `DeviceToken` is role-agnostic and knows
 * nothing about customers — so this one is joined back through the customer's
 * own `userId` rather than its `_id`.
 */
const deviceStats = (userIds) =>
  DeviceToken.aggregate([
    { $match: { userId: { $in: userIds }, isActive: true } },
    {
      $group: {
        _id: "$userId",
        activeDeviceCount: { $sum: 1 },
        platforms: { $addToSet: "$platform" },
        lastSeenAt: { $max: "$lastSeenAt" },
      },
    },
  ]);

/** Group an aggregation's rows by their `_id`, as strings. */
const indexById = (rows) => new Map(rows.map((row) => [String(row._id), row]));

/** A stats block with every key present, whether or not the customer had rows. */
const withDefaults = (defaults, found) => {
  if (!found) return { ...defaults };
  const { _id, ...rest } = found;
  return { ...defaults, ...rest };
};

/**
 * Assemble one customer's five blocks out of the collected maps.
 *
 * Every block is present with zeroes even for a customer who has done nothing,
 * so no reader has to null-check its way down. A brand-new customer and a
 * customer whose aggregation silently returned nothing look the same here on
 * purpose: both genuinely have no activity.
 */
const buildBlocks = (maps, customerId, userId) => {
  const id = String(customerId);
  const uid = userId ? String(userId) : null;

  const claim = withDefaults(EMPTY_CLAIMS, maps.claims.get(id));
  const refund = withDefaults(EMPTY_REFUNDS, maps.refunds.get(id));
  const dispute = withDefaults(EMPTY_DISPUTES, maps.disputes.get(id));
  const promo = withDefaults(EMPTY_PROMO, maps.promos.get(id));
  const location = maps.locations.get(id);
  const bank = maps.banks.get(id);
  const device = uid ? maps.devices.get(uid) : null;

  const settledClaims = claim.paidClaims + claim.redeemedClaims;

  return {
    /**
     * What they have bought.
     *
     * `grossSpend` is every rupee captured on a claim still in `PAID` or
     * `REDEEMED`; `netSpend` takes the completed refunds back off it. Both are
     * reported because they answer different questions — gross is what we
     * charged, net is what we kept — and a single "spend" figure would have to
     * silently pick one.
     */
    claims: {
      ...claim,
      totalBilled: round2(claim.totalBilled),
      grossSpend: round2(claim.grossSpend),
      totalSaved: round2(claim.totalSaved),
      netSpend: round2(claim.grossSpend - refund.refundedAmount),
      averageClaimValue:
        settledClaims > 0 ? round2(claim.grossSpend / settledClaims) : 0,
    },

    /**
     * What they have asked back, and what the bank has pulled back.
     *
     * `refusedRequests` and `openRequests` are the two an admin acts on:
     * together they are the pattern `REFUND_DEFAULTS.maxOpenRequests` and
     * `maxRejectedPerWindow` exist to catch.
     */
    refunds: { ...refund, refundedAmount: round2(refund.refundedAmount) },
    disputes: { ...dispute, disputedAmount: round2(dispute.disputedAmount) },

    engagement: {
      followingCount: maps.follows.get(id)?.followingCount || 0,
      avoidedBrandsCount: maps.avoidances.get(id)?.avoidedBrandsCount || 0,
      ...promo,
      promoDiscountAvailed: round2(promo.promoDiscountAvailed),
    },

    /**
     * How complete this customer is, and whether we can actually reach them.
     *
     * `hasVerifiedBankAccount` is the one that matters operationally: a refund
     * whose `SOURCE` leg failed goes nowhere without it, and the request sits in
     * `AWAITING_BANK_DETAILS` holding the vendor's money out of every settlement
     * until somebody notices.
     */
    profile: {
      addressCount: location?.addressCount || 0,
      primaryAddress: location?.primaryAddress || null,
      bankAccountCount: bank?.bankAccountCount || 0,
      hasVerifiedBankAccount: (bank?.verifiedBankAccountCount || 0) > 0,
      activeDeviceCount: device?.activeDeviceCount || 0,
      devicePlatforms: device?.platforms || [],
      lastSeenAt: device?.lastSeenAt || null,
    },
  };
};

const EMPTY_MAPS = {
  claims: new Map(),
  refunds: new Map(),
  disputes: new Map(),
  follows: new Map(),
  avoidances: new Map(),
  promos: new Map(),
  locations: new Map(),
  banks: new Map(),
  devices: new Map(),
};

/**
 * Fetch every block for a set of customers, in parallel, in one round of nine
 * indexed `{ $in: … }` aggregations.
 *
 * @param {object} args
 * @param {Array} args.customerIds  the `Customer._id`s to report on
 * @param {Array} args.userIds      their `User._id`s — push reach is keyed there
 * @returns {Promise<{statsFor: (customerId, userId) => object}>}
 */
exports.collectCustomerStats = async ({ customerIds = [], userIds = [] }) => {
  if (customerIds.length === 0) {
    return { statsFor: (id, uid) => buildBlocks(EMPTY_MAPS, id, uid) };
  }

  const [
    claims,
    refunds,
    disputes,
    follows,
    avoidances,
    promos,
    locations,
    banks,
    devices,
  ] = await Promise.all([
    claimStats(customerIds),
    refundStats(customerIds),
    disputeStats(customerIds),
    followStats(customerIds),
    avoidanceStats(customerIds),
    promoStats(customerIds),
    locationStats(customerIds),
    bankStats(customerIds),
    // A customer with no `userId` — the residue of a half-finished signup that
    // `repairRoleProfile` has not seen yet — would otherwise send `[undefined]`
    // into the match.
    userIds.length ? deviceStats(userIds) : [],
  ]);

  const maps = {
    claims: indexById(claims),
    refunds: indexById(refunds),
    disputes: indexById(disputes),
    follows: indexById(follows),
    avoidances: indexById(avoidances),
    promos: indexById(promos),
    locations: indexById(locations),
    banks: indexById(banks),
    devices: indexById(devices),
  };

  return { statsFor: (id, uid) => buildBlocks(maps, id, uid) };
};

/** The single-customer form. Same code path, one-element arrays. */
exports.getCustomerStats = async (customerId, userId) => {
  const collected = await exports.collectCustomerStats({
    customerIds: [customerId],
    userIds: userId ? [userId] : [],
  });
  return collected.statsFor(customerId, userId);
};

exports.round2 = round2;
exports.SPENDING_STATUSES = SPENDING_STATUSES;
exports.REFUSED_STATUSES = REFUSED_STATUSES;
