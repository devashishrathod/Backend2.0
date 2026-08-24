const express = require("express");
const router = express.Router();
const { validateSchema, verifyJwtToken } = require("../middlewares");
const {
  register,
  login,
  loginOrSignUp,
  verifyOtp,
  loginWithEmail,
  verifyOtpWithEmail,
  loginWithMobile,
  verifyOtpWithMobile,
  logout,
  setPasswordHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
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
  validateSetPassword,
  validateForgotPassword,
  validateResetPassword,
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
// ---------------------------------------------------------------------------
// Password set / reset
//
// Accounts created through an OTP flow start with **no** password — they used to
// all share one seeded value with no way to change it. Password login is only
// possible once the user has been through here.
// ---------------------------------------------------------------------------

// Signed in: set a password for the first time, or change an existing one.
router.post(
  "/set-password",
  verifyJwtToken,
  validateSchema(validateSetPassword),
  setPasswordHandler,
);

// Public, two steps. `forgot-password` answers identically whether or not the
// account exists, so it cannot be used to enumerate registered contacts.
router.post(
  "/forgot-password",
  validateSchema(validateForgotPassword),
  forgotPasswordHandler,
);
router.post(
  "/reset-password",
  validateSchema(validateResetPassword),
  resetPasswordHandler,
);

router.post("/logout", verifyJwtToken, logout);

module.exports = router;
