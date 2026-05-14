const express = require("express");
const router = express.Router();
const { ROLES } = require("../constants");

const {
  createVoucher,
  getAllVouchers,
  getVoucher,
  updateVoucher,
  likeOrDislikeVoucher,
} = require("../controller/vouchers");
const { verifyToken, checkRole, loadBrand } = require("../middleware");

router.post(
  "/add/:brandId",
  verifyToken,
  checkRole(ROLES.VENDOR),
  loadBrand,
  createVoucher
);
router.get("/getAll", verifyToken, getAllVouchers);
router.get("/get/:voucherId", verifyToken, getVoucher);
router.put("/update/:id", verifyToken, checkRole(ROLES.VENDOR), updateVoucher);
router.put(
  "/:voucherId/toggle-like",
  verifyToken,
  checkRole(ROLES.USER),
  likeOrDislikeVoucher
);

module.exports = router;
