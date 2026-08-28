const express = require("express");
const router = express.Router();
const {
  validateSchema,
  verifyJwtTokenEvenIfDeactivated,
  isAdmin,
} = require("../middlewares");
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

// Creating an account here is an admin action. It used to be public with `role`
// defaulting to ADMIN, so anyone who could reach the endpoint could mint
// themselves a super admin. The very first admin is seeded with
// `node scripts/seedAdmin.js` instead.
router.post("/register", isAdmin, validateSchema(validateRegisterUser), register);

// Password sign-in is admin-only by product decision — customers and vendors
// authenticate with a WhatsApp OTP. The role restriction lives in the validator
// so the refusal is a clean 422 rather than a confusing "user not found".
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
// Password set / reset — ADMIN ONLY.
//
// Accounts created through an OTP flow start with **no** password — they used to
// all share one seeded value with no way to change it. Password login is only
// possible once the user has been through here, and by product decision only an
// admin gets that option: customers and vendors sign in with a WhatsApp OTP, so
// giving them a password would add a credential to steal and nothing else.
// ---------------------------------------------------------------------------

// Signed in: set a password for the first time, or change an existing one.
router.post(
  "/set-password",
  isAdmin,
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

// Deliberately reachable by a deactivated account: every other gate answers a
// suspended user with a 401 so the client signs them out, and refusing the sign
// out itself would be the one thing that leaves them stuck.
router.post("/logout", verifyJwtTokenEvenIfDeactivated, logout);

module.exports = router;
