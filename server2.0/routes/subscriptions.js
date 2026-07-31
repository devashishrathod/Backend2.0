const express = require("express");
const router = express.Router();

const { isAdmin, verifyJwtToken, validateSchema } = require("../middlewares");
const {
  create,
  getAll,
  get,
  update,
  deleteSubscription,
} = require("../controllers/subscriptions");
const {
  validateCreateSubscription,
  validateUpdateSubscription,
  validateGetAllSubscriptions,
} = require("../validator/subscriptions");

router.post(
  "/add",
  isAdmin,
  validateSchema(validateCreateSubscription),
  create,
);
router.get(
  "/getAll",
  verifyJwtToken,
  validateSchema(validateGetAllSubscriptions),
  getAll,
);
router.get("/get/:id", verifyJwtToken, get);
router.put(
  "/update/:id",
  isAdmin,
  validateSchema(validateUpdateSubscription),
  update,
);
router.delete("/delete/:id", isAdmin, deleteSubscription);

module.exports = router;
