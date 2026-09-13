const express = require("express");
const router = express.Router();

const {
  validateSchema,
  verifyJwtToken,
  isCustomer,
  isBrandSideOrAdmin,
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

// Brand and outlet addresses.
//
// `isBrandSideOrAdmin` rather than `isVendorOrAdmin`: an outlet manager may keep
// their **own** outlet's address. Which brand or outlet any of them may touch is
// decided by `resolveLocationTarget` inside the service — a vendor is bound to
// their own brand, a sub-vendor to the single outlet on their token, and an
// admin may act for anyone. A gate decides *whether*, not *whose*.
router.post(
  "/create",
  isBrandSideOrAdmin,
  validateSchema(validateCreateLocation),
  create,
);
router.get(
  "/getAll",
  isBrandSideOrAdmin,
  validateSchema(validateGetAllLocationsQuery),
  getAll,
);
router.put(
  "/update/:id",
  isBrandSideOrAdmin,
  validateSchema(validateUpdateLocation),
  update,
);
/**
 * ⚠️ `verifyJwtToken`, not a role gate — the same shape as `GET /get/:id` below.
 *
 * A customer may remove their own address, and there is no role that describes
 * "customer, vendor, outlet manager or admin" because the question is not about
 * roles at all: it is whether this address is yours. `resolveLocationTarget`
 * answers that, per kind, and refuses anyone else with a 403.
 *
 * ⚠️ For a customer this is a bigger button than it looks. Their voucher feed is
 * built from this address — `resolveCustomerCoordinates` — so once it is gone
 * the feed answers "Location is required" until the app sends coordinates or
 * they save a new one. The app should say so before asking.
 */
router.delete(
  "/delete/:id",
  verifyJwtToken,
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
