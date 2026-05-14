const express = require("express");
const router = express.Router();
const { ROLES } = require("../constants");

const {
  getAllState,
  addState,
  updateState,
  deleteState,
  getAllHome,
  getOne,
  addHomeApplication,
  updateHomeApplication,
  deleteHomeApplication,
  getDealOfCategories,
  getDealOfDayPagination,
  addDealOfCategory,
  updateDealOfCategory,
  deleteDealOfCategory,
  getAllPrivacy,
  getSinglePrivacy,
  addPrivacy,
  updatePrivacy,
  deletePrivacy,
  getAllFilter,
  addFilter,
  updateFilter,
  deleteFilter,
  pagination,
  getAllRefundPolicy,
  getSingleRefundPolicy,
  addRefundPolicy,
  updateRefundPolicy,
  deleteRefundPolicy,
  getAllTerms,
  getSingleTerms,
  addTerms,
  updateTerms,
  deleteTerms,
  getSingleLegal,
  getAllLegal,
  addLegal,
  updateLegal,
  deleteLegal,
} = require("../controller/application");

const { verifyToken, checkRole } = require("../middleware/authValidation");

// ================================= home ===================================
router.get("/home/getOne/:id", getAllHome);
router.get("/home/getAll", getAllHome);
router.get("/home/single", getOne);
router.post(
  "/home/add",
  verifyToken,
  checkRole(ROLES.ADMIN),
  addHomeApplication
);
router.put(
  "/home/update/:id",
  verifyToken,
  checkRole(ROLES.ADMIN),
  updateHomeApplication
);
router.delete(
  "/home/delete/:id",
  verifyToken,
  checkRole(ROLES.ADMIN),
  deleteHomeApplication
);

// ================================= dealOfDay ===================================
router.get("/dealOfDay/getOne/:id", getDealOfCategories);
router.get("/dealOfDay/getAll", getDealOfCategories);
router.get("/dealOfDay/pagination", getDealOfDayPagination);
router.post(
  "/dealOfDay/add",
  verifyToken,
  checkRole(ROLES.ADMIN),
  addDealOfCategory
);
router.put(
  "/dealOfDay/update/:id",
  verifyToken,
  checkRole(ROLES.ADMIN),
  updateDealOfCategory
);
router.delete(
  "/dealOfDay/delete/:id",
  verifyToken,
  checkRole(ROLES.ADMIN),
  deleteDealOfCategory
);

// ================================= privacy ===================================
router.get("/privacy/getOne/:id", getAllPrivacy);
router.get("/privacy/getAll", getAllPrivacy);
router.get("/privacy/single", getSinglePrivacy);
router.post("/privacy/add", verifyToken, checkRole(ROLES.ADMIN), addPrivacy);
router.put(
  "/privacy/update/:id",
  verifyToken,
  checkRole(ROLES.ADMIN),
  updatePrivacy
);
router.delete(
  "/privacy/delete/:id",
  verifyToken,
  checkRole(ROLES.ADMIN),
  deletePrivacy
);

// ================================= state ===================================
router.get("/state/getAll", getAllState);
router.get("/state/getOne/:id", getAllState);
router.post("/state/add", verifyToken, checkRole(ROLES.ADMIN), addState);
router.put(
  "/state/update/:id",
  verifyToken,
  checkRole(ROLES.ADMIN),
  updateState
);
router.delete(
  "/state/delete/:id",
  verifyToken,
  checkRole(ROLES.ADMIN),
  deleteState
);

// ================================= filter ===================================
router.get("/filter/getAll", getAllFilter);
router.get("/filter/getOne/:id", getAllFilter);
router.get("/filter/pagination", pagination);
router.post("/filter/add", verifyToken, checkRole(ROLES.ADMIN), addFilter);
router.put(
  "/filter/update/:id",
  verifyToken,
  checkRole(ROLES.ADMIN),
  updateFilter
);
router.delete(
  "/filter/delete/:id",
  verifyToken,
  checkRole(ROLES.ADMIN),
  deleteFilter
);

// ================================= refundPolicy ===================================
router.get("/refundPolicy/getOne/:id", getAllRefundPolicy);
router.get("/refundPolicy/getAll", getAllRefundPolicy);
router.get("/refundPolicy/single", getSingleRefundPolicy);
router.post(
  "/refundPolicy/add",
  verifyToken,
  checkRole(ROLES.ADMIN),
  addRefundPolicy
);
router.put(
  "/refundPolicy/update/:id",
  verifyToken,
  checkRole(ROLES.ADMIN),
  updateRefundPolicy
);
router.delete(
  "/refundPolicy/delete/:id",
  verifyToken,
  checkRole(ROLES.ADMIN),
  deleteRefundPolicy
);

// ================================= term ===================================
router.get("/term/getOne/:id", getAllTerms);
router.get("/term/getAll", getAllTerms);
router.get("/term/single", getSingleTerms);
router.post("/term/add", verifyToken, checkRole(ROLES.ADMIN), addTerms);
router.put(
  "/term/update/:id",
  verifyToken,
  checkRole(ROLES.ADMIN),
  updateTerms
);
router.delete(
  "/term/delete/:id",
  verifyToken,
  checkRole(ROLES.ADMIN),
  deleteTerms
);

// ================================= legal ===================================
router.get("/legal/getOne/:id", getAllLegal);
router.get("/legal/getAll", getAllLegal);
router.get("/legal/single", getSingleLegal);
router.post("/legal/add", verifyToken, checkRole(ROLES.ADMIN), addLegal);
router.put(
  "/legal/update/:id",
  verifyToken,
  checkRole(ROLES.ADMIN),
  updateLegal
);
router.delete(
  "/legal/delete/:id",
  verifyToken,
  checkRole(ROLES.ADMIN),
  deleteLegal
);

// ======================================= search history ===============================
const {
  globalSearch,
  getRecentSearchHistory,
  deleteSearchHistory,
} = require("../controller/searchHistory");

router.get("/global-search", verifyToken, globalSearch);
router.get("/recent-search", verifyToken, getRecentSearchHistory);
router.delete(
  "/:queryId/delete-search-history",
  verifyToken,
  deleteSearchHistory
);

// ================================= dashboard analytics ===============================
const { getDashboardReport } = require("../controller/application/index");
router.get(
  "/dashboard-analytics",
  verifyToken,
  checkRole(ROLES.ADMIN, ROLES.SUB_VENDOR, ROLES.VENDOR),
  getDashboardReport
);

module.exports = { router, routePrefix: "/settings" };
