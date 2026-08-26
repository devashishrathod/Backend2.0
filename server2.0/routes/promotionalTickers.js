const express = require("express");
const router = express.Router();

const { validateSchema, isAdmin, isCustomer } = require("../middlewares");
const {
  create,
  get,
  getAll,
  update,
  deleteTicker,
  getActiveForCustomer,
} = require("../controllers/promotionalTickers");
const {
  validateCreateTicker,
  validateUpdateTicker,
  validateGetTicker,
  validateGetAllTickers,
  validateDeleteTicker,
} = require("../validator/promotionalTicker");

// ---------------------------------------------------------------------------
// App-level ticker strip — same ownership story as banners: platform content,
// so admin-managed. Previously any authenticated token could write here.
// ---------------------------------------------------------------------------

router.post("/create", isAdmin, validateSchema(validateCreateTicker), create);
router.put(
  "/update/:id",
  isAdmin,
  validateSchema(validateUpdateTicker),
  update,
);
router.get("/get-all", isAdmin, validateSchema(validateGetAllTickers), getAll);
router.get("/get/:id", isAdmin, validateSchema(validateGetTicker), get);
router.delete(
  "/delete/:id",
  isAdmin,
  validateSchema(validateDeleteTicker),
  deleteTicker,
);

// The tickers the customer app renders, in display order.
router.get("/customer/active", isCustomer, getActiveForCustomer);

module.exports = router;
