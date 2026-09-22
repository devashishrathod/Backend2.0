const express = require("express");
const router = express.Router();

const {
  validateSchema,
  isAdmin,
  isCustomer,
  isVendorOrAdmin,
} = require("../middlewares");
const {
  create,
  update,
  getAll,
  get,
  report,
  deletePromo,
  getForCustomer,
  getForVendor,
} = require("../controllers/promoCodes");
const {
  validateCreatePromoCode,
  validateUpdatePromoCode,
  validateGetAllPromoCodes,
  validateGetPromoCode,
  validatePromoCodeReport,
  validateDeletePromoCode,
  validateGetCustomerPromoCodes,
  validateGetVendorPromoCodes,
} = require("../validator/promoCodes");

// ---------------------------------------------------------------------------
// Each audience's own listing of the codes it may use.
//
// ⚠️ These two are declared **above** `router.use(isAdmin)` and carry their own
// gate. Everything below that line inherits it, so a route added there is
// admin-only whether or not anybody remembered — which is the safe direction to
// forget in, and the reason the blanket gate stays. Anything added up here must
// name its gate explicitly; an unauthenticated listing would hand every live
// campaign to a stranger with a script.
//
// Both are read-only. Managing codes is still admin work, and redeeming one is
// still `POST /voucher-claims/create-order` and `/transactions/subscribe/create-order`.
// ---------------------------------------------------------------------------

// Signed-in customers only. The listing counts *this* customer's usage and
// answers "can you use it right now", neither of which a guest has an answer
// for — `optionalAuth` here would return a list that lies to everyone not
// logged in.
router.get(
  "/customer/get-all",
  isCustomer,
  validateSchema(validateGetCustomerPromoCodes),
  getForCustomer,
);

// `isVendorOrAdmin`, the same gate as `POST /transactions/subscribe/preview`:
// an admin who can preview a purchase for a brand can see the codes that
// purchase could use. The brand itself is resolved by `resolveActorBrand`, so a
// vendor can never read another brand's usage.
router.get(
  "/vendor/get-all",
  isVendorOrAdmin,
  validateSchema(validateGetVendorPromoCodes),
  getForVendor,
);

// ---------------------------------------------------------------------------
// Admin only from here down. Vendors and customers never manage codes — they
// list them above and redeem them at their own checkout.
// ---------------------------------------------------------------------------
router.use(isAdmin);

router.post("/create", validateSchema(validateCreatePromoCode), create);
router.get("/get-all", validateSchema(validateGetAllPromoCodes), getAll);
router.get("/reports", validateSchema(validatePromoCodeReport), report);
router.get("/get/:id", validateSchema(validateGetPromoCode), get);
router.put("/update/:id", validateSchema(validateUpdatePromoCode), update);
router.delete(
  "/delete/:id",
  validateSchema(validateDeletePromoCode),
  deletePromo,
);

module.exports = router;
