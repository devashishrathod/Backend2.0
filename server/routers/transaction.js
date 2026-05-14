const express = require("express");
const router = express.Router();
const { ROLES } = require("../constants");

const { verifyToken, checkRole } = require("../middleware");
const {
  getAllTransactions,
  getCurrentTransaction,
  getAllClaimedTransactions,
  removeTransaction,
  getOverallPerDayTransaction,
} = require("../controller/transactions");

router.get(
  "/getAll",
  verifyToken,
  checkRole(ROLES.ADMIN, ROLES.VENDOR),
  getAllTransactions
);
router.get(
  "/getCurrent",
  verifyToken,
  checkRole(ROLES.ADMIN, ROLES.VENDOR),
  getCurrentTransaction
);
router.get("/get-all-claimed-vouchers", verifyToken, getAllClaimedTransactions);
router.get(
  "/get-overall-per-day",
  verifyToken,
  checkRole(ROLES.ADMIN),
  getOverallPerDayTransaction
);
router.put(
  "/:transactionId/remove",
  verifyToken,
  checkRole(ROLES.USER),
  removeTransaction
);

module.exports = router;
