const express = require("express");
const router = express.Router();

const {
  validateSchema,
  isCustomer,
  verifyJwtToken,
} = require("../middlewares");
const {
  createOrder,
  verifyPayment,
  listPayments,
  listClaims,
  paymentDetail,
  claimDetail,
} = require("../controllers/voucherClaims");
const {
  validateCreateClaimOrder,
  validateVerifyClaimPayment,
  validateListClaimPayments,
  validateListClaims,
  validateClaimTransactionDetail,
  validateClaimDetail,
  validateClaimByCode,
} = require("../validator/voucherClaims");

/**
 * Opening an order is the moment money starts moving, so unlike the preview
 * this is signed-in only. A guest gets a price; a guest does not get an order.
 */
router.post(
  "/create-order",
  isCustomer,
  validateSchema(validateCreateClaimOrder),
  createOrder,
);

/**
 * Mounted at `/voucher-claims`, not `/voucherClaims`.
 *
 * `routes/index.js` derives the prefix from the filename, and the filename stays
 * camelCase to match every other module here. Without the override the endpoint
 * would answer at `/voucherClaims` while every document, every Postman request
 * and the app all call `/voucher-claims`.
 *
 * ⚠️ Exported as `{ router, routePrefix }`, **not** as `exports.routePrefix`
 * beside `module.exports = router`. The second assignment replaces the exports
 * object entirely, so the prefix is silently lost and the route mounts at the
 * filename — which is exactly what happened on the first attempt, with no error
 * anywhere. The boot log is the only place it showed.
 */
/**
 * The browser callback. Also `isCustomer`: the settlement checks that the claim
 * belongs to the caller, and an anonymous caller has nothing to check against.
 */
router.post(
  "/verify",
  isCustomer,
  validateSchema(validateVerifyClaimPayment),
  verifyPayment,
);

/**
 * ---------------- listings ----------------
 *
 * `verifyJwtToken` rather than a role gate: **one endpoint, three shapes.** The
 * scope and the projection are both derived from the token inside, so a customer,
 * a vendor, an outlet and an admin all call the same URL and each gets their
 * own answer. A role gate here would mean four endpoints and four chances for
 * one of them to leak a field the others hide.
 */
router.get(
  "/payments",
  verifyJwtToken,
  validateSchema(validateListClaimPayments),
  listPayments,
);

/**
 * One payment, and where the push notification's deep link lands.
 *
 * Declared after `/payments` so the literal wins over the parameter. Express
 * matches in declaration order, and `/payments/:transactionId` registered first
 * would still not shadow `/payments` — but the day someone adds
 * `/payments/summary` it would, silently, and be read as an id.
 */
router.get(
  "/payments/:transactionId",
  verifyJwtToken,
  validateSchema(validateClaimTransactionDetail),
  paymentDetail,
);

router.get(
  "/",
  verifyJwtToken,
  validateSchema(validateListClaims),
  listClaims,
);

/**
 * ---------------- one claim ----------------
 *
 * ⚠️ **`/code/:claimCode` must be declared before `/:claimId`.**
 *
 * Express matches in declaration order, and `/:claimId` would swallow
 * `/code/TD-ABC123` whole — `claimId` would be the literal string `"code"`, the
 * ObjectId validator would reject it, and the counter would get a 422 about a
 * perfectly good code. A literal segment always goes above the parameter that
 * could eat it.
 */
router.get(
  "/code/:claimCode",
  verifyJwtToken,
  validateSchema(validateClaimByCode),
  claimDetail,
);

router.get(
  "/:claimId",
  verifyJwtToken,
  validateSchema(validateClaimDetail),
  claimDetail,
);

module.exports = { router, routePrefix: "/voucher-claims" };
