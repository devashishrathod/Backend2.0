const express = require("express");
const router = express.Router();

const { validateSchema, validateRoles, verifyJwtToken } = require("../middlewares");
const { ROLES } = require("../constants");
const { signUp, update, getAll } = require("../controllers/subBrands");
const {
  validateWhatsappSubBrandSignUp,
  validateUpdateSubBrand,
  validateGetAllSubBrands,
} = require("../validator/subBrands");

const isVendorOrAdmin = validateRoles(ROLES.VENDOR, ROLES.ADMIN);

// Creating an outlet consumes a slot from the brand's plan, so it is gated to
// the brand owner (or an admin) rather than any authenticated user.
router.post(
  "/signUp-with-whatsapp",
  isVendorOrAdmin,
  validateSchema(validateWhatsappSubBrandSignUp),
  signUp,
);
router.get(
  "/get-all",
  verifyJwtToken,
  validateSchema(validateGetAllSubBrands),
  getAll,
);
// Can move an outlet between the outlet and franchise pools, so it needs the
// same gate as creation; ownership is enforced inside the service.
router.put(
  "/update/:subBrandId",
  isVendorOrAdmin,
  validateSchema(validateUpdateSubBrand),
  update,
);

module.exports = router;
