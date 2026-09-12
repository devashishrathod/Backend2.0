const express = require("express");
const router = express.Router();

const {
  validateSchema,
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
// A brand's highlight points.
//
// Reads carry no gate at all — not "every signed-in role", which is what this
// said and is not the same thing. A brand profile opens from a shared link
// before anyone has logged in, and the collections cover that case explicitly
// ("Guest — Brand features"). Features are public marketing copy; there is
// nothing here to withhold from a visitor who can already see the brand.
//
// Writes belong to the brand owner or an admin, and that takes **two** checks:
// `isVendorOrAdmin` decides the caller is a vendor at all, and
// `resolveActorBrand` inside each service decides it is *this* brand's vendor.
//
// ⚠️ Only the first of those existed for a long time, and the note here claimed
// the job was done — so a reader had no reason to look. `brandId` arrives in
// the body on create, and update and delete found the record by `featureId`
// alone, so any vendor could write to any brand. See
// `__tests__/money/brandFeatureOwnership.test.js`.
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
  validateSchema(validateGetAllBrandFeatures),
  getAll,
);
router.get(
  "/get/:featureId",
  validateSchema(validateGetBrandFeature),
  get,
);

module.exports = router;
