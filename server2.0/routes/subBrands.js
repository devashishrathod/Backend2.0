const express = require("express");
const router = express.Router();

const { validateSchema, verifyJwtToken } = require("../middlewares");
const { signUp, update, getAll } = require("../controllers/subBrands");
const {
  validateWhatsappSubBrandSignUp,
  validateUpdateSubBrand,
  validateGetAllSubBrands,
} = require("../validator/subBrands");

router.use(verifyJwtToken);

router.post(
  "/signUp-with-whatsapp",
  validateSchema(validateWhatsappSubBrandSignUp),
  signUp,
);
router.get("/get-all", validateSchema(validateGetAllSubBrands), getAll);
router.put(
  "/update/:subBrandId",
  validateSchema(validateUpdateSubBrand),
  update,
);

module.exports = router;
