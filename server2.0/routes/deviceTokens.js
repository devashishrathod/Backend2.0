const express = require("express");
const router = express.Router();

const {
  verifyJwtToken,
  verifyJwtTokenEvenIfDeactivated,
  validateSchema,
} = require("../middlewares");
const { register, unregister, getMine, testPush } = require("../controllers/deviceTokens");
const {
  validateRegisterDeviceToken,
  validateUnregisterDeviceToken,
  validateGetMyDevices,
  validateSendTestPush,
} = require("../validator/deviceTokens");

// Any signed-in user, whatever their role. A customer's phone registers exactly
// the same way a vendor's does — that is the point of keeping this role-agnostic.
//
// Declared per route rather than as a `router.use`, because unregister needs a
// different gate from the other three (see below) and a router-level middleware
// runs before any of them can opt out.
router.post(
  "/register",
  verifyJwtToken,
  validateSchema(validateRegisterDeviceToken),
  register,
);
// Deliberately reachable by a deactivated account: a suspended user has to be
// able to stop the push notifications reaching their phone. The toggle already
// retires their devices server-side, but a client retrying its own unregister
// must not be refused.
router.put(
  "/unregister",
  verifyJwtTokenEvenIfDeactivated,
  validateSchema(validateUnregisterDeviceToken),
  unregister,
);
router.get(
  "/get-mine",
  verifyJwtToken,
  validateSchema(validateGetMyDevices),
  getMine,
);
// Delivery check against the caller's own devices only.
router.post(
  "/test",
  verifyJwtToken,
  validateSchema(validateSendTestPush),
  testPush,
);

module.exports = router;
