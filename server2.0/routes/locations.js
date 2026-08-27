const express = require("express");
const router = express.Router();

const {
  validateSchema,
  verifyJwtToken,
  isCustomer,
  isVendorOrAdmin,
} = require("../middlewares");
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
  validateUpsertLocation,
  validateGetAllLocationsQuery,
  validateGetLocation,
  validateUpdateLocation,
} = require("../validator/locations");

// ---------------------------------------------------------------------------
// One Location model serves three things — a customer's address, a brand's
// registered address, and an outlet's. The gates below split on who owns which.
//
// These routes previously ran only `verifyJwtToken`, so `GET /getAll` handed
// any authenticated caller every address on the platform, customers' homes
// included.
// ---------------------------------------------------------------------------

// Brand and outlet addresses. A vendor is bound to their own brand inside the
// service; an admin may act on any.
router.post(
  "/create",
  isVendorOrAdmin,
  validateSchema(validateCreateLocation),
  create,
);
router.get(
  "/getAll",
  isVendorOrAdmin,
  validateSchema(validateGetAllLocationsQuery),
  getAll,
);
router.put(
  "/update/:id",
  isVendorOrAdmin,
  validateSchema(validateUpdateLocation),
  update,
);
router.delete(
  "/delete/:id",
  isVendorOrAdmin,
  validateSchema(validateGetLocation),
  deleteLocation,
);

// The customer's single saved address. Scoped to the token holder — the
// endpoint no longer accepts a `userId`.
router.post(
  "/upsert",
  isCustomer,
  validateSchema(validateUpsertLocation),
  upsert,
);

// Every role reads a location by id, so the gate here is only "signed in";
// which location you are allowed to see is decided per-role in the service.
router.get(
  "/get/:id",
  verifyJwtToken,
  validateSchema(validateGetLocation),
  get,
);

module.exports = router;
