const Transaction = require("../../models/Transaction");
const VoucherClaim = require("../../models/VoucherClaim");

const { throwError } = require("../../utils");
const { PAYMENT_GATEWAYS } = require("../../constants/subscription");
const { TRANSACTION_PURPOSE } = require("../../constants/transaction");
const {
  generateRazorpaySignature,
  getPaymentDetails,
  buildTransactionFilter,
} = require("../../helpers/transactions");
const { settleVoucherClaimPayment } = require("../../helpers/voucherClaims");
const { resolveCustomerId } = require("../../helpers/customers");

/**
 * Verify a Razorpay payment from the customer's browser and settle the claim.
 *
 * This endpoint authenticates the caller and the payment; the settlement itself
 * lives in `helpers/voucherClaims/settleVoucherClaimPayment.js`, shared with the
 * webhook. Both paths therefore run the same redemption, usage row, promo commit
 * and ledger posting — there is no second implementation to drift.
 *
 * **The two paths race by design.** The browser callback and the webhook
 * normally land within milliseconds of each other. The shared settlement claims
 * the transaction with a conditional update on `verified: false`, so exactly one
 * of them does the work and the other is told it is already done.
 *
 * ### Three things this checks that a signature alone does not
 *
 * A valid signature proves Razorpay produced the payment. It does not prove the
 * payment belongs to *this* order, that the right amount arrived, or that the
 * person asking is the person who paid.
 *
 *  1. **The order matches.** `payment.order_id` against ours, so a signature
 *     lifted from another payment cannot settle this claim.
 *  2. **The account is read off the transaction**, never hardcoded. It was
 *     written when the order was created, so "which secret verifies this" is a
 *     fact about the row rather than something this call site has to remember.
 *     Getting it wrong means a signature that can never match, with the money
 *     already captured.
 *  3. **Ownership is the customer**, not the user who happened to be signed in.
 *     A claim belongs to a customer record; checking `userId` would let a second
 *     account sharing a user settle someone else's payment.
 *
 * @param {object} actor    the request — `customerId` must be present
 * @param {object} payload  validated body
 */
exports.verifyVoucherClaimPayment = async (actor, payload) => {
  const {
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
    transactionId,
  } = payload;

  const customerId = resolveCustomerId(actor);
  if (!customerId) {
    throwError(401, "Please log in to confirm this payment.");
  }

  // Scoped to VOUCHER_CLAIM. One collection holds both money flows, and looking
  // up a transaction by id alone would let a customer point this endpoint at a
  // vendor's subscription payment.
  const transaction = await Transaction.findOne({
    ...buildTransactionFilter({ purpose: TRANSACTION_PURPOSE.VOUCHER_CLAIM }),
    _id: transactionId,
  });
  if (!transaction) throwError(404, "Payment not found.");

  if (transaction.gateway !== PAYMENT_GATEWAYS.RAZORPAY) {
    throwError(422, "This payment was not created through Razorpay.");
  }
  if (transaction.razorpayOrderId !== razorpayOrderId) {
    throwError(422, "This payment does not belong to the given order.");
  }

  // The claim is the customer's, and so is this payment. Compared on the
  // customer record rather than the user id — see above.
  if (String(transaction.customerId) !== String(customerId)) {
    throwError(403, "You are not authorized to confirm this payment.");
  }

  const claim = await VoucherClaim.findOne({ transactionId: transaction._id });
  if (!claim) {
    throwError(500, "This payment has no voucher claim attached to it.");
  }

  /**
   * Fast path for an obvious replay — including one the webhook already
   * settled.
   *
   * The authoritative guard is the conditional claim inside the shared
   * settlement; this only avoids a pointless round trip to Razorpay.
   */
  if (transaction.verified) {
    return {
      claim,
      transaction,
      alreadyVerified: true,
      invoiceUrl: transaction.invoiceUrl || null,
    };
  }

  const expectedSignature = generateRazorpaySignature(
    razorpayOrderId,
    razorpayPaymentId,
    transaction.gatewayAccount,
  );
  if (expectedSignature !== razorpaySignature) {
    throwError(400, "Invalid signature. Payment may be tampered.");
  }

  let payment;
  try {
    payment = await getPaymentDetails(
      razorpayPaymentId,
      transaction.gatewayAccount,
    );
  } catch (error) {
    console.error("[verifyClaim] Razorpay lookup failed:", error?.message);
    throwError(503, "Razorpay services unavailable! Please try again later.");
  }
  if (!payment) {
    throwError(503, "Razorpay services unavailable! Please try again later.");
  }

  /**
   * The payment must be for this order, and for the right amount.
   *
   * A signature proves Razorpay made the payment; it says nothing about which
   * order it belongs to. Without this, a genuine ₹1 payment on another order
   * could be presented here and settle a ₹760 claim.
   */
  if (payment.order_id && payment.order_id !== razorpayOrderId) {
    throwError(422, "This payment belongs to a different order.");
  }
  const expectedPaise = claim.pricing?.amountInPaise;
  if (expectedPaise && payment.amount !== expectedPaise) {
    throwError(
      422,
      "The amount paid does not match this claim. Please contact support.",
    );
  }

  const result = await settleVoucherClaimPayment({
    transaction,
    payment,
    actor,
  });

  return {
    ...result,
    // The webhook may have won the race and settled first — still a success.
    alreadyVerified: result.alreadySettled,
  };
};
