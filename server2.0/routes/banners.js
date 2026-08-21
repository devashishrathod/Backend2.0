const express = require("express");
const router = express.Router();

const { verifyJwtToken, validateSchema } = require("../middlewares");
const {
  create,
  get,
  getAll,
  update,
  deleteBanner,
  getActiveForCustomer,
} = require("../controllers/banners");
const {
  validateCreateBanner,
  validateUpdateBanner,
  validateGetBanner,
  validateGetAllBanners,
  validateDeleteBanner,
} = require("../validator/banners");

router.use(verifyJwtToken);

router.post("/create", validateSchema(validateCreateBanner), create);
router.put("/update/:id", validateSchema(validateUpdateBanner), update);
router.get("/get-all", validateSchema(validateGetAllBanners), getAll);
router.get("/get/:id", validateSchema(validateGetBanner), get);
router.delete(
  "/delete/:id",
  validateSchema(validateDeleteBanner),
  deleteBanner,
);
// Customer
router.get("/customer/active", getActiveForCustomer);

module.exports = router;
