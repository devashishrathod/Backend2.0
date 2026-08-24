const express = require("express");
const router = express.Router();
const {
  validateSchema,
  validateRoles,
  isAdmin,
} = require("../middlewares");
const { ROLES } = require("../constants");

const {
  validateSubscribePreview,
  validateCreateSubscribeOrder,
  validateVerifySubscribeTransaction,
  validateRegenerateInvoice,
  validateGetWebhookEvents,
  validateGetWebhookEvent,
  validateReplayWebhookEvent,
  validateGetDisputes,
} = require("../validator/transactions");
const {
  subscribePreview,
  subscribeCreateOrder,
  subscribeVerifyTransaction,
  invoiceRegenerate,
  razorpayWebhook,
  webhookEventList,
  webhookEventGet,
  webhookReplay,
  disputeList,
} = require("../controllers/transactions");

// These routes previously ran only `verifyJwtToken`, so any authenticated user
// — including a customer — could open and verify an order against any brand.
// Ownership is enforced per-brand inside the services via resolveActorBrand.
const isVendorOrAdmin = validateRoles(ROLES.VENDOR, ROLES.ADMIN);

// ---------------------------------------------------------------------------
// PUBLIC — Razorpay webhook.
//
// Deliberately unauthenticated: Razorpay cannot present a JWT. Authenticity
// comes from the HMAC over the raw request body, verified inside the service
// against RAZORPAY_WEBHOOK_SECRET. Declared first so no auth middleware can be
// accidentally applied to it later.
//
// This is what makes activation independent of the browser: a vendor who closes
// the tab mid-payment still gets their plan, because Razorpay tells us directly.
// ---------------------------------------------------------------------------
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

module.exports = router;
