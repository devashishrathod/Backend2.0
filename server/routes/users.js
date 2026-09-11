const express = require("express");
const router = express.Router();

const {
  getUser,
  updateUser,
  adminUpdateContactHandler,
} = require("../controllers/users");
const {
  verifyJwtToken,
  isAdmin,
  validateSchema,
} = require("../middlewares");
const { validateAdminUpdateContact } = require("../validator/users");

router.get("/get", verifyJwtToken, getUser);
router.put("/update", verifyJwtToken, updateUser);

// ---------------------------------------------------------------------------
// An admin changes somebody's contact details for them.
//
// ⚠️ This is the **only** path that can move a `whatsappNumber` without an OTP,
// and it exists for one case: somebody whose old SIM is gone. Changing that
// number normally requires proving the number being left behind, which they
// cannot do — so without this they can never sign in again.
//
// It changes the value; it does not verify it. Every key lands `false`, the
// account is signed out everywhere if the login number moved, and an unverified
// email or mobile cannot be signed in with at all — which is what stops this
// from being a way into an account. `reason` is required.
// ---------------------------------------------------------------------------
router.patch(
  "/admin/:userId/contact",
  isAdmin,
  validateSchema(validateAdminUpdateContact),
  adminUpdateContactHandler,
);
router.delete("/delete", verifyJwtToken, (req, res) => {
  res.status(200).json({ message: "User deleted successfully" });
});

module.exports = router;
