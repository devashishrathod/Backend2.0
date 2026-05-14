const express = require("express");
const router = express.Router();
const { ROLES } = require("../constants");

const { verifyToken, checkRole } = require("../middleware");
const {
  createSuggestionAd,
  getAllSuggestionAds,
} = require("../controller/suggestionAds");

router.post(
  "/:voucherId/create",
  verifyToken,
  checkRole(ROLES.ADMIN),
  createSuggestionAd
);
router.get(
  "/getAll",
  verifyToken,
  checkRole(ROLES.ADMIN, ROLES.USER),
  getAllSuggestionAds
);

module.exports = router;
