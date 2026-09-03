const { throwError } = require("../../utils");
const {
  TRANSACTION_PURPOSE,
  RAZORPAY_ACCOUNTS,
} = require("../../constants/transaction");

/**
 * The only way to build a `Transaction` query filter.
 *
 * One collection now holds two money flows — vendor subscriptions and customer
 * voucher claims. The single biggest risk in that arrangement is not
 * performance, it is a forgotten `purpose`: a vendor earnings listing that
 * quietly includes customer payments, or a webhook that settles a voucher claim
 * through the subscription path. Both are silent, and both involve money.
 *
 * So `purpose` is a REQUIRED argument. Not defaulted, not inferred — a caller
 * that wants every purpose has to say so with `purpose: null`, which reads as a
 * deliberate choice at the call site rather than an omission. That case is real
 * (the admin ledger, the disputes worklist), which is why it is spelled rather
 * than forbidden.
 *
 * `isDeleted: false` is always applied; pass `includeDeleted: true` for the
 * admin views that need to see soft-deleted rows.
 *
 * @param {object}  args
 * @param {string|null} args.purpose  TRANSACTION_PURPOSE value, or explicit
 *        null for "every purpose, deliberately"
 * @returns {object} a Mongo filter
 */
exports.buildTransactionFilter = ({
  purpose,
  gatewayAccount,
  brandId,
  customerId,
  subBrandId,
  subscriptionId,
  voucherId,
  claimId,
  settlementId,
  status,
  verified,
  settlementHold,
  from,
  to,
  includeDeleted = false,
} = {}) => {
  // `undefined` is the mistake this guard exists for. `null` is the escape
  // hatch and passes through.
  if (purpose === undefined) {
    throwError(
      500,
      "Transaction query needs a purpose. Pass a TRANSACTION_PURPOSE value, or `purpose: null` to deliberately span both.",
    );
  }

  if (purpose !== null && !Object.values(TRANSACTION_PURPOSE).includes(purpose)) {
    throwError(500, `Unknown transaction purpose: ${purpose}`);
  }

  if (
    gatewayAccount !== undefined &&
    !Object.values(RAZORPAY_ACCOUNTS).includes(gatewayAccount)
  ) {
    throwError(500, `Unknown Razorpay account: ${gatewayAccount}`);
  }

  const filter = {};

  if (purpose !== null) filter.purpose = purpose;
  if (!includeDeleted) filter.isDeleted = false;

  if (gatewayAccount !== undefined) filter.gatewayAccount = gatewayAccount;
  if (brandId) filter.brandId = brandId;
  if (customerId) filter.customerId = customerId;
  if (subBrandId) filter.subBrandId = subBrandId;
  if (subscriptionId) filter.subscriptionId = subscriptionId;
  if (voucherId) filter["voucher.voucherId"] = voucherId;
  if (claimId) filter["voucher.claimId"] = claimId;
  if (settlementId !== undefined) filter.settlementId = settlementId;
  if (status) filter.status = status;
  if (typeof verified === "boolean") filter.verified = verified;
  if (typeof settlementHold === "boolean") filter.settlementHold = settlementHold;

  // A window on either side alone is valid — "since Monday" and "up to the
  // 31st" are both ordinary requests.
  if (from || to) {
    filter.createdAt = {
      ...(from ? { $gte: new Date(from) } : {}),
      ...(to ? { $lte: new Date(to) } : {}),
    };
  }

  return filter;
};
