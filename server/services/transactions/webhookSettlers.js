const { TRANSACTION_PURPOSE } = require("../../constants/transaction");
const { settleSubscriptionPayment } = require("../../helpers/subscribeds");
const {
  settleVoucherClaimPayment,
} = require("../../helpers/voucherClaims");

/**
 * Which settlement path a captured payment belongs to.
 *
 * One `Transaction` collection now holds two completely different money flows,
 * and the webhook receiver has no way to tell them apart from the Razorpay
 * payload alone — it only ever sees an order id. Before this map it simply ran
 * `settleSubscriptionPayment` on whatever it found, so the first customer
 * voucher payment would have failed on "Subscription plan not found", been
 * recorded FAILED, and paged admins CRITICAL. On every single payment.
 *
 * A registry rather than a switch for one reason: **an unknown purpose must be
 * a hard stop, not a fallthrough.** Guessing which settler to run on a money
 * row is how a customer's ₹760 gets settled against a vendor's ₹4,999
 * subscription. If a purpose is not in here, the delivery is recorded as FAILED
 * and a human is told — which is recoverable, unlike the alternative.
 *
 * Both purposes are registered now. The two settlers share nothing but their
 * shape — a captured payment in, an idempotent settlement out — which is the
 * point: a voucher claim and a subscription have almost no logic in common, and
 * a single function branching on purpose would have been the worst of both.
 */
const SETTLERS = Object.freeze({
  [TRANSACTION_PURPOSE.SUBSCRIPTION]: settleSubscriptionPayment,
  [TRANSACTION_PURPOSE.VOUCHER_CLAIM]: settleVoucherClaimPayment,
});

/**
 * @param {string} purpose TRANSACTION_PURPOSE value from the transaction
 * @returns {Function|null} the settler, or null when there is none
 */
exports.resolveSettler = (purpose) => SETTLERS[purpose] || null;

exports.SETTLER_PURPOSES = Object.freeze(Object.keys(SETTLERS));
