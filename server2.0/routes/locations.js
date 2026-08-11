const express = require("express");
const router = express.Router();

const { validateSchema, verifyJwtToken } = require("../middlewares");
const {
  create,
  getAll,
  get,
  update,
  upsert,
  deleteLocation,
} = require("../controllers/locations");
const {
  validateCreateLocation,
  validateGetAllLocationsQuery,
  validateGetLocation,
  validateUpdateLocation,
} = require("../validator/locations");

router.use(verifyJwtToken);

router.post("/create", validateSchema(validateCreateLocation), create);
router.get("/getAll", validateSchema(validateGetAllLocationsQuery), getAll);
router.get("/get/:id", validateSchema(validateGetLocation), get);
router.post("/upsert", validateSchema(validateCreateLocation), upsert); // customer use only one location
router.put("/update/:id", validateSchema(validateUpdateLocation), update);
router.delete(
  "/delete/:id",
  validateSchema(validateGetLocation),
  deleteLocation,
);

module.exports = router;
