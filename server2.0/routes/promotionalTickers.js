const express = require("express");
const router = express.Router();

const { verifyJwtToken, validateSchema } = require("../middlewares");
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

router.use(verifyJwtToken);

router.post("/create", validateSchema(validateCreateTicker), create);
router.put("/update/:id", validateSchema(validateUpdateTicker), update);
router.get("/get-all", validateSchema(validateGetAllTickers), getAll);
router.get("/get/:id", validateSchema(validateGetTicker), get);
router.delete(
  "/delete/:id",
  validateSchema(validateDeleteTicker),
  deleteTicker,
);

// Customer
router.get("/customer/active", getActiveForCustomer);

module.exports = router;
