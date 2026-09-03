const express = require("express");
const router = express.Router();
const {
  validateSchema,
  isAdmin,
  isVendorOrAdmin,
} = require("../middlewares");

const {
  validateSubscribePreview,
  validateCreateSubscribeOrder,
  validateVerifySubscribeTransaction,
  validateRegenerateInvoice,
  validateGetWebhookEvents,
  validateGetWebhookEvent,
  validateReplayWebhookEvent,
  validateGetDisputes,
  validateReleaseHold,
} = require("../validator/transactions");
const {
  subscribePreview,
  subscribeCreateOrder,
  subscribeVerifyTransaction,
  invoiceRegenerate,
  razorpayWebhook,
  razorpayCustomerWebhook,
  invoiceByToken,
  webhookEventList,
  webhookEventGet,
  webhookReplay,
  disputeList,
  releaseHold,
  paymentHealth,
} = require("../controllers/transactions");

// These routes previously ran only `verifyJwtToken`, so any authenticated user
// — including a customer — could open and verify an order against any brand.
// Ownership is enforced per-brand inside the services via resolveActorBrand.

// ---------------------------------------------------------------------------
// PUBLIC — Razorpay webhooks. One endpoint per account.
//
// Deliberately unauthenticated: Razorpay cannot present a JWT. Authenticity
// comes from the HMAC over the raw request body, verified inside the service
// against that account's webhook secrets. Declared first so no auth middleware
// can be accidentally applied to them later.
//
// Two endpoints because the two Razorpay accounts are separate merchants with
// separate webhook secrets — and because it makes the account a property of the
// URL. The signature then only has to prove the payload is authentic, not tell
// us whose it is.
//
// This is what makes activation independent of the browser: a customer who
// closes the tab mid-payment still gets their claim, because Razorpay tells us
// directly.
//
//   Razorpay dashboard → Settings → Webhooks
//     VENDOR account   → {PUBLIC_API_URL}/trydood/v1/transactions/webhook/razorpay
//     CUSTOMER account → {PUBLIC_API_URL}/trydood/v1/transactions/webhook/razorpay/customer
// ---------------------------------------------------------------------------
/**
 * The public invoice link. **No JWT** — see the controller.
 *
 * Declared beside the webhooks, before any auth middleware, for the same reason
 * they are: everything below `router.use(verifyJwtToken)` would reject a browser
 * arriving from a WhatsApp message.
 */
router.get("/invoice/:token", invoiceByToken);

router.post("/webhook/razorpay/customer", razorpayCustomerWebhook);
router.post("/webhook/razorpay", razorpayWebhook);

router.post(
  "/subscribe/preview",
  isVendorOrAdmin,
  validateSchema(validateSubscribePreview),
  subscribePreview,
);
router.post(
  "/subscribe/create-order",
  isVendorOrAdmin,
  validateSchema(validateCreateSubscribeOrder),
  subscribeCreateOrder,
);
router.post(
  "/subscribe/verify-transaction",
  isVendorOrAdmin,
  validateSchema(validateVerifySubscribeTransaction),
  subscribeVerifyTransaction,
);

// Re-issue a PDF invoice from the pricing frozen on the transaction. Amounts are
// never recomputed, so an old invoice reproduces exactly what was charged.
// A vendor may re-issue their own; an admin any.
router.post(
  "/invoice/regenerate",
  isVendorOrAdmin,
  validateSchema(validateRegenerateInvoice),
  invoiceRegenerate,
);

// ---------------------------------------------------------------------------
// Webhook operations — admin only.
//
// Deliveries were already stored but invisible outside the database, so a FAILED
// event (money captured, plan not live, and Razorpay will not retry once it has
// our 200) could sit unnoticed. These make it visible and recoverable.
// ---------------------------------------------------------------------------
router.get(
  "/webhook/events",
  isAdmin,
  validateSchema(validateGetWebhookEvents),
  webhookEventList,
);
router.get(
  "/webhook/events/:eventId",
  isAdmin,
  validateSchema(validateGetWebhookEvent),
  webhookEventGet,
);
// Re-runs the stored payload through the same processing the receiver uses.
// Safe twice over: the settlement claims the transaction conditionally, so a
// replay of something already settled reports that instead of double-activating.
router.post(
  "/webhook/replay/:eventId",
  isAdmin,
  validateSchema(validateReplayWebhookEvent),
  webhookReplay,
);

// Chargebacks, soonest response deadline first. Missing the deadline forfeits
// the money automatically, so this is a worklist rather than a report.
router.get(
  "/disputes",
  isAdmin,
  validateSchema(validateGetDisputes),
  disputeList,
);

/**
 * ---------------- payment health ----------------
 *
 * Not a liveness probe — the server answering proves that. This answers the
 * question an admin actually has: did anything get stuck overnight, and is
 * anything quietly losing money right now?
 *
 * No validator: it takes nothing. A query parameter here would only be a way to
 * ask for a less complete answer.
 */
router.get("/admin/health", isAdmin, paymentHealth);

/**
 * Let a held payment back into the settlement run.
 *
 * ### ⚠️ Why this endpoint exists
 *
 * `settlementHold` is monotonic by design: five paths set it and, until this,
 * exactly one cleared it — and that one is reachable only from a refund being
 * rejected. Everything else that holds money had **no way out at all**: a
 * chargeback (including one we *won*), a refund that reached `FAILED`, a refund
 * issued from the Razorpay dashboard, a completed refund.
 *
 * The dispute webhook says as much in its own comment — *"releasing it is an
 * explicit admin action, taken once somebody has decided who bears the loss"* —
 * and that action was never built. A vendor whose chargeback we won had that
 * money frozen out of every future settlement, permanently, silently.
 *
 * It refuses while a refund is still open: the customer is owed an answer first,
 * and deciding the refund releases the hold on its own.
 */
router.patch(
  "/admin/:transactionId/release-hold",
  isAdmin,
  validateSchema(validateReleaseHold),
  releaseHold,
);

module.exports = router;
