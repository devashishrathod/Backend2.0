const { asyncWrapper, sendSuccess } = require("../../utils");
const { handleRazorpayWebhook } = require("../../services/transactions");
const { WEBHOOK_DEFAULTS } = require("../../constants/webhook");
const { RAZORPAY_ACCOUNTS } = require("../../constants/transaction");

/**
 * Public endpoint for the **CUSTOMER** Razorpay account — voucher claim
 * payments. Its twin for vendor subscriptions is `razorpayWebhook.js`.
 *
 * Two endpoints rather than one, because the two accounts are separate
 * merchants with separate webhook secrets, and Razorpay configures a webhook
 * URL per account anyway. Splitting them means the account is known from the
 * URL *before* anything is verified — so a signature only has to prove the
 * payload is authentic, not tell us whose it is.
 *
 * The receiver still falls back to the other account's secrets and processes a
 * cross-posted delivery, raising a warning rather than dropping it. A dashboard
 * pointed at the wrong URL should self-heal; it just must not do so silently.
 */
exports.razorpayCustomerWebhook = asyncWrapper(async (req, res) => {
  const result = await handleRazorpayWebhook({
    // Stashed by the body-parser `verify` hook in index.js — Razorpay signs the
    // untouched bytes, so re-serialised JSON would not match.
    rawBody: req.rawBody,
    signature: req.headers[WEBHOOK_DEFAULTS.signatureHeader],
    eventId: req.headers[WEBHOOK_DEFAULTS.eventIdHeader],
    body: req.body,
    account: RAZORPAY_ACCOUNTS.CUSTOMER,
    sourceIp: req.headers["x-forwarded-for"] || req.socket?.remoteAddress,
  });
  return sendSuccess(res, 200, "Webhook received", result);
});
