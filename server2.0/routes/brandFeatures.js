const express = require("express");
const router = express.Router();

const { validateSchema, verifyJwtToken } = require("../middlewares");
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

router.use(verifyJwtToken);

router.post("/add", validateSchema(validateAddBrandFeature), create);
router.get("/get-all", validateSchema(validateGetAllBrandFeatures), getAll);
router.get("/get/:featureId", validateSchema(validateGetBrandFeature), get);
router.put(
  "/update/:featureId",
  validateSchema(validateUpdateBrandFeature),
  update,
);
router.delete(
  "/delete/:featureId",
  validateSchema(validateDeleteBrandFeature),
  deleteFeature,
);

module.exports = router;
