const express = require("express");
const router = express.Router();
const { ROLES } = require("../constants");

const {
  addTodayOffer,
  getAllOffers,
  getTodayOfferCategories,
  getTodayOffersAllVouchers,
} = require("../controller/todayOffer");
const { verifyToken, checkRole } = require("../middleware");

router.post("/add", verifyToken, checkRole(ROLES.ADMIN), addTodayOffer);
router.get(
  "/get-categories",
  verifyToken,
  checkRole(ROLES.USER),
  getTodayOfferCategories
);
router.get(
  "/get-all-vouchers/:categoryId",
  verifyToken,
  checkRole(ROLES.USER, ROLES.ADMIN),
  getTodayOffersAllVouchers
);
router.get(
  "/get-all-offers",
  verifyToken,
  checkRole(ROLES.ADMIN),
  getAllOffers
);

module.exports = router;
