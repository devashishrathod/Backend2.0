const express = require("express");
const router = express.Router();
const {
  validateSchema,
  isAdmin,
  isVendorOrAdmin,
  isVendorOrSubVendor,
  verifyJwtToken,
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
  validateAddDisputeEvidence,
  validateDisputeEvidencePack,
  validateReleaseHold,
} = require("../validator/transactions");
const {
  subscribePreview,
  subscribeCreateOrder,
  subscribeVerifyTransaction,
  invoiceRegenerate,
  razorpayWebhook,
  razorpayCustomerWebhook,
  webhookEventList,
  webhookEventGet,
  webhookReplay,
  disputeList,
  disputeAddEvidence,
  disputeEvidencePack,
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
 * The public invoice link lives at `GET /documents/:token` now — see
 * `routes/documents.js`.
 *
 * It was here, and `/settlements/statement/:token` was the other half. Between
 * them they served two of the six document kinds and each carried its own token
 * field name, so a refund receipt and a chargeback advice would have made it four
 * routes and four field names — and a bare token still could not be resolved
 * without already knowing which kind it was.
 */

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

/**
 * ---------------- chargebacks — ⚠️ the canonical home is `routes/disputes.js`
 *
 * A dispute began as ten denormalised fields on `Transaction`, which is why
 * these live here. It is its own collection now, with its own model, jobs,
 * notifications and worklist, and `/disputes` is where it belongs.
 *
 * ⚠️ These three stay because the Postman collections and anything already
 * integrated point at them — a 404 is a worse answer than a duplicate line in a
 * route table. They mount the **same controllers**, so there is exactly one
 * implementation and nothing can drift, and
 * `__tests__/money/disputeVisibility.test.js` asserts that.
 *
 * ⚠️ **Add nothing new here.** New dispute routes go on `/disputes` only —
 * `GET /disputes/:disputeId` already does. Growing both mounts is how a surface
 * kept for compatibility turns into a second surface to maintain.
 * ---------------------------------------------------------------------------
 */

/**
 * Chargebacks, soonest response deadline first. Missing the deadline forfeits
 * the money automatically, so this is a worklist rather than a report.
 *
 * ⚠️ Token-gated, not `isAdmin`. A vendor sees their **own brand's** disputes —
 * scoped inside the service, in the filter — because until they could, a
 * chargeback showed up as money that silently stopped arriving and later a
 * deduction with no sale attached to it. Their shape carries none of our queue:
 * no deadline, no alert count, no recovery state. See `docs/dispute_flow.md` §4.
 */
router.get(
  /**
   * ⚠️ `verifyJwtToken` explicitly. This router has **no** blanket
   * `router.use(verifyJwtToken)` — every route carries its own gate, and the
   * public invoice link at the top is why. Dropping `isAdmin` without putting
   * this in its place would have made the whole chargeback worklist readable by
   * anyone with the URL.
   */
  "/disputes",
  verifyJwtToken,
  validateSchema(validateGetDisputes),
  disputeList,
);

/**
 * What only the outlet has — a bill or KOT number, a camera timestamp, what the
 * staff remember.
 *
 * ⚠️ A bonus, never a dependency: `buildEvidencePack` stands on our own records,
 * and filing never waits on the vendor because a dispute gets **one** response
 * and the deadline is the bank's.
 */
router.post(
  "/disputes/:disputeId/evidence",
  isVendorOrSubVendor,
  validateSchema(validateAddDisputeEvidence),
  disputeAddEvidence,
);

/**
 * Everything we can prove, with the argument already written out — for the admin
 * filing it in the Razorpay dashboard.
 *
 * ⚠️ Admin only: it carries the customer's masked contact, the whole claim
 * timeline and the case we intend to make.
 */
router.get(
  "/disputes/:disputeId/evidence-pack",
  isAdmin,
  validateSchema(validateDisputeEvidencePack),
  disputeEvidencePack,
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
