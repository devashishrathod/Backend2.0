const express = require("express");
const router = express.Router();

const { validateSchema, isAdmin, isCustomer } = require("../middlewares");
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

// ---------------------------------------------------------------------------
// App-level home banners — not tied to any brand, so managing them is an admin
// job. The whole file used to sit behind a bare `verifyJwtToken`, which meant a
// customer's own token was enough to create, edit or delete what every user of
// the app sees on the home screen.
// ---------------------------------------------------------------------------

router.post("/create", isAdmin, validateSchema(validateCreateBanner), create);
router.put(
  "/update/:id",
  isAdmin,
  validateSchema(validateUpdateBanner),
  update,
);
router.get("/get-all", isAdmin, validateSchema(validateGetAllBanners), getAll);
router.get("/get/:id", isAdmin, validateSchema(validateGetBanner), get);
router.delete(
  "/delete/:id",
  isAdmin,
  validateSchema(validateDeleteBanner),
  deleteBanner,
);

// The one banner the customer app renders.
router.get("/customer/active", isCustomer, getActiveForCustomer);

module.exports = router;
