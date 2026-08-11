const express = require("express");
const router = express.Router();

const { validateSchema, verifyJwtToken } = require("../middlewares");
const { signUp, update } = require("../controllers/subBrands");
const {
  validateWhatsappSubBrandSignUp,
  validateUpdateSubBrand,
} = require("../validator/subBrands");

router.use(verifyJwtToken);

router.post(
  "/signUp-with-whatsapp",
  validateSchema(validateWhatsappSubBrandSignUp),
  signUp,
);
router.put(
  "/update/:subBrandId",
  validateSchema(validateUpdateSubBrand),
  update,
);

module.exports = router;
