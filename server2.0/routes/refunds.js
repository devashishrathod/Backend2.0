const express = require("express");
const router = express.Router();

const {
  validateSchema,
  verifyJwtToken,
  isCustomer,
  isVendorOrSubVendor,
  isAdmin,
} = require("../middlewares");
const {
  raiseRefund,
  approveRefund,
  rejectRefund,
  withdrawRefund,
  adminApproveRefund,
  adminRejectRefund,
  payRefund,
  listRefunds,
  refundDetail,
} = require("../controllers/refunds");
const {
  validateRequestRefund,
  validateApproveRefund,
  validateRejectRefund,
  validateWithdrawRefund,
  validateAdminApproveRefund,
  validateAdminRejectRefund,
  validatePayRefund,
  validateListRefunds,
  validateRefundDetail,
  validateRequestRefundBankDetails,
  validateChooseRefundBankAccount,
  validatePayRefundToBank,
  validateConfirmRefundBankPayout,
  validateFailRefundBankPayout,
} = require("../validator/refunds");
const {
  requestRefundBankDetails,
  chooseRefundBankAccount,
  payRefundToBankAccount,
  confirmRefundBankPayout,
  failRefundBankPayout,
} = require("../controllers/refunds");

/**
 * The customer asks for their money back.
 *
 * `isCustomer` — ownership is checked on the **customer**, not the user, so two
 * people sharing one login cannot refund each other's claims.
 */
router.post("/", isCustomer, validateSchema(validateRequestRefund), raiseRefund);

/**
 * The customer withdraws it again.
 *
 * Declared before `/:requestId/...` verbs read by the brand side purely for
 * readability — the paths do not overlap, but the customer's two routes belong
 * together.
 */
router.patch(
  "/:requestId/withdraw",
  isCustomer,
  validateSchema(validateWithdrawRefund),
  withdrawRefund,
);

/**
 * The customer says where a failed refund should go instead.
 *
 * `isCustomer`, and the service checks the refund is theirs — the account is
 * chosen from their own verified list, so nobody can point someone else's refund
 * anywhere.
 */
router.patch(
  "/:requestId/bank-account",
  isCustomer,
  validateSchema(validateChooseRefundBankAccount),
  chooseRefundBankAccount,
);

/**
 * ---------------- the vendor decides ----------------
 *
 * `isVendorOrSubVendor`: an outlet manager decides what happened at their own
 * counter, and the service narrows them to it. The admin does **not** appear
 * here — on the normal path the vendor approves and the admin only executes.
 * An admin override is a separate route with its own reason field, counted
 * separately, because a rising override rate means something upstream is wrong.
 */
router.patch(
  "/:requestId/approve",
  isVendorOrSubVendor,
  validateSchema(validateApproveRefund),
  approveRefund,
);

router.patch(
  "/:requestId/reject",
  isVendorOrSubVendor,
  validateSchema(validateRejectRefund),
  rejectRefund,
);

/**
 * ---------------- the admin executes ----------------
 *
 * On the normal path the admin is **not a second gate** — the vendor already
 * decided and this only releases the money. Overriding a vendor's `no`, or their
 * silence, is the same endpoint with a written reason, flagged so it can be
 * counted separately: a rising override rate does not mean admins are generous,
 * it means something upstream is wrong.
 */
router.patch(
  "/admin/:requestId/approve",
  isAdmin,
  validateSchema(validateAdminApproveRefund),
  adminApproveRefund,
);

router.patch(
  "/admin/:requestId/reject",
  isAdmin,
  validateSchema(validateAdminRejectRefund),
  adminRejectRefund,
);

/**
 * Money out — the one step with no undo.
 *
 * Safe to call twice: `attemptCount` is bumped before the gateway call, so a
 * retry after a crash asks Razorpay what already exists instead of sending the
 * customer their money a second time.
 */
router.patch(
  "/admin/:requestId/pay",
  isAdmin,
  validateSchema(validatePayRefund),
  payRefund,
);

/**
 * ---------------- MANUAL_BANK ----------------
 *
 * The fallback for when the original card or UPI cannot take the money back.
 * `SOURCE` fails every time against a closed instrument, and before this the
 * admin had no second button: the request sat `FAILED`, the vendor's money
 * stayed held, and the customer never got theirs.
 *
 * ⚠️ Separate from `/pay` on purpose. That one calls a gateway; these open a
 * `PayoutLeg`, wait for a person to make a NEFT, and are finished by a UTR typed
 * in by hand. See `services/refunds/manualBankRefund.js`.
 */
router.patch(
  "/admin/:requestId/request-bank-details",
  isAdmin,
  validateSchema(validateRequestRefundBankDetails),
  requestRefundBankDetails,
);

router.patch(
  "/admin/:requestId/pay-to-bank",
  isAdmin,
  validateSchema(validatePayRefundToBank),
  payRefundToBankAccount,
);

router.patch(
  "/admin/:requestId/confirm-bank-payout",
  isAdmin,
  validateSchema(validateConfirmRefundBankPayout),
  confirmRefundBankPayout,
);

router.patch(
  "/admin/:requestId/fail-bank-payout",
  isAdmin,
  validateSchema(validateFailRefundBankPayout),
  failRefundBankPayout,
);

/**
 * ---------------- reading them ----------------
 *
 * `verifyJwtToken` rather than a role gate: **one endpoint, three shapes.** The
 * scope and the projection are both derived from the token inside, so a
 * customer, a vendor, an outlet and an admin all call the same URL and each gets
 * their own answer. A role gate here would mean three endpoints and three
 * chances for one of them to leak a field the others hide — and `split` carries
 * our promo share and the MDR we swallow on the same sub-document the vendor
 * legitimately needs.
 *
 * `/:requestId` does not swallow `/admin/:requestId/pay` — they differ in
 * segment count, so ordering is not load-bearing here. It would be the moment
 * somebody adds a two-segment literal such as `/admin/summary`, which is why
 * the literal routes stay above it.
 */
router.get("/", verifyJwtToken, validateSchema(validateListRefunds), listRefunds);

router.get(
  "/:requestId",
  verifyJwtToken,
  validateSchema(validateRefundDetail),
  refundDetail,
);

module.exports = router;
