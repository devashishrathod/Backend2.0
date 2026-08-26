const express = require("express");
const router = express.Router();

const {
  validateSchema,
  verifyJwtToken,
  isVendorOrAdmin,
} = require("../middlewares");
const {
  validateAddBrandFeature,
  validateGetAllBrandFeatures,
  validateGetBrandFeature,
  validateUpdateBrandFeature,
  validateDeleteBrandFeature,
} = require("../validator/brandFeatures");
const {
  create,
  getAll,
  get,
  update,
  deleteFeature,
} = require("../controllers/brandFeatures");

// ---------------------------------------------------------------------------
// A brand's highlight points. Reads are open to every signed-in role because
// the customer app shows them on the brand profile; writes belong to the brand
// owner or an admin. Before this, a customer's token could edit any brand's
// features — `brandId` arrives in the body, so nothing scoped the write.
// ---------------------------------------------------------------------------

router.post(
  "/add",
  isVendorOrAdmin,
  validateSchema(validateAddBrandFeature),
  create,
);
router.put(
  "/update/:featureId",
  isVendorOrAdmin,
  validateSchema(validateUpdateBrandFeature),
  update,
);
router.delete(
  "/delete/:featureId",
  isVendorOrAdmin,
  validateSchema(validateDeleteBrandFeature),
  deleteFeature,
);

// Reads — customer brand profile needs these.
router.get(
  "/get-all",
  verifyJwtToken,
  validateSchema(validateGetAllBrandFeatures),
  getAll,
);
router.get(
  "/get/:featureId",
  verifyJwtToken,
  validateSchema(validateGetBrandFeature),
  get,
);

module.exports = router;
