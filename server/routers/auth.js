const express = require("express");
const router = express.Router();

const {
  register,
  login,
  loginOrSignUp,
  verifyOtp,
} = require("../controller/auth");

router.post("/register", register); // register Admin or any role specific for Admin
router.post("/login", login); // login with email / mobile and password
// router.put("/logout", verifyToken, logout); 
router.post("/loginOrSignUp", loginOrSignUp); // login or sign up with whatsapp
router.put("/verifyOtp", verifyOtp); // verify otp with whatsapp

module.exports = router;
