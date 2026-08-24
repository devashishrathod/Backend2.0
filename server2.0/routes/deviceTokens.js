const express = require("express");
const router = express.Router();

const { verifyJwtToken, validateSchema } = require("../middlewares");
const { register, unregister, getMine, testPush } = require("../controllers/deviceTokens");
const {
  validateRegisterDeviceToken,
  validateUnregisterDeviceToken,
  validateGetMyDevices,
  validateSendTestPush,
} = require("../validator/deviceTokens");

// Any signed-in user, whatever their role. A customer's phone registers exactly
// the same way a vendor's does — that is the point of keeping this role-agnostic.
router.use(verifyJwtToken);

router.post("/register", validateSchema(validateRegisterDeviceToken), register);
router.put("/unregister", validateSchema(validateUnregisterDeviceToken), unregister);
router.get("/get-mine", validateSchema(validateGetMyDevices), getMine);
// Delivery check against the caller's own devices only.
router.post("/test", validateSchema(validateSendTestPush), testPush);

module.exports = router;
