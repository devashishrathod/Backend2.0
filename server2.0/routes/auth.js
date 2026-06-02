const express = require("express");
const router = express.Router();
const { validateSchema } = require("../middlewares");
const {
  register,
  login,
  loginOrSignUp,
  verifyOtp,
  loginWithEmail,
  verifyOtpWithEmail,
  loginWithMobile,
  verifyOtpWithMobile,
} = require("../controllers/auth");
const {
  validateRegisterUser,
  validateLogin,
  validateWhatsappLoginOrSignUp,
  validateWhatsappVerifyOtp,
  validateSendEmailLogin,
  validateVerifyEmailOtp,
  validateSendMobileLogin,
  validateVerifyMobileOtp,
} = require("../validator/auth");

router.post("/register", validateSchema(validateRegisterUser), register);
router.post("/login", validateSchema(validateLogin), login);
router.post(
  "/loginOrSignUp-with-whatsapp",
  validateSchema(validateWhatsappLoginOrSignUp),
  loginOrSignUp,
);
router.post(
  "/verify-otp-whatsapp",
  validateSchema(validateWhatsappVerifyOtp),
  verifyOtp,
);
router.post(
  "/login-with-email",
  validateSchema(validateSendEmailLogin),
  loginWithEmail,
);
router.post(
  "/verify-otp-email",
  validateSchema(validateVerifyEmailOtp),
  verifyOtpWithEmail,
);
router.post(
  "/login-with-mobile",
  validateSchema(validateSendMobileLogin),
  loginWithMobile,
);
router.post(
  "/verify-otp-mobile",
  validateSchema(validateVerifyMobileOtp),
  verifyOtpWithMobile,
);

module.exports = router;
