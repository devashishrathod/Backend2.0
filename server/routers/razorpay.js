const express = require("express");
const router = express.Router();
//const txnRouter = express.Router();

const { verifyToken, checkRole } = require("../middleware/authValidation");
const {
  createOrder,
  verifyTransaction,
  //  getAllTransactions,
  //  getCurrentTransaction,
} = require("../controller/transactions");
const { ROLES } = require("../constants");

router.post(
  "/create-order",
  verifyToken,
  checkRole(ROLES.ADMIN, ROLES.VENDOR),
  createOrder
);
router.put(
  "/verifyPayment",
  verifyToken,
  checkRole(ROLES.ADMIN, ROLES.VENDOR),
  verifyTransaction
);
// txnRouter.get(
//   "/getAll",
//   verifyToken,
//   checkRole(ROLES.ADMIN, ROLES.VENDOR),
//   getAllTransactions
// );
// txnRouter.get(
//   "/getCurrent",
//   verifyToken,
//   checkRole(ROLES.ADMIN, ROLES.VENDOR),
//   getCurrentTransaction
// );

module.exports = {
  router,
  //routePrefix: "/razorpay", // default
  //  extraRoutes: [
  // { path: "/transaction", router: txnRouter }, // mount /api/transaction/*
  //  ],
};
