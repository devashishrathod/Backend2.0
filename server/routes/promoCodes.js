const express = require("express");
const router = express.Router();

const { validateSchema, isAdmin } = require("../middlewares");
const {
  create,
  update,
  getAll,
  get,
  report,
  deletePromo,
} = require("../controllers/promoCodes");
const {
  validateCreatePromoCode,
  validateUpdatePromoCode,
  validateGetAllPromoCodes,
  validateGetPromoCode,
  validatePromoCodeReport,
  validateDeletePromoCode,
} = require("../validator/promoCodes");

// Admin only throughout. Vendors never manage codes — they redeem them through
// POST /transactions/subscribe/preview and /create-order.
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
