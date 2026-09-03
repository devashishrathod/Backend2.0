const crypto = require("crypto");
const { getRazorpayAccount } = require("../../configs/razorpay");

/**
 * The per-payment HMAC Razorpay's checkout callback carries.
 *
 * Takes a **RAZORPAY_ACCOUNTS value**, not a role. The two are not the same
 * thing and conflating them is how a customer's payment ends up checked against
 * the vendor account's secret — a signature that can never match, with the
 * money already captured and the customer staring at a 400.
 *
 * Callers must pass `transaction.gatewayAccount`. That value is written on the
 * row when the order is created, so "which secret verifies this payment" is a
 * fact about the transaction rather than a convention each call site remembers.
 *
 * @param {string} orderId
 * @param {string} paymentId
 * @param {string} account  RAZORPAY_ACCOUNTS value
 */
exports.generateRazorpaySignature = (orderId, paymentId, account) => {
  const { keySecret } = getRazorpayAccount(account);
  return crypto
    .createHmac("sha256", keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
};
