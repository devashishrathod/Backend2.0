const express = require("express");
const router = express.Router();

const { validateSchema, optionalAuth, isCustomer } = require("../middlewares");
const {
  globalSearch,
  getSearchHistory,
  deleteSearchHistoryEntry,
  clearSearchHistory,
  getPopularSearches,
} = require("../controllers/search");
const {
  validateGlobalSearch,
  validateGetSearchHistory,
  validateDeleteSearchHistoryEntry,
} = require("../validator/search");

// ---------------------------------------------------------------------------
// Recent searches — the customer's own, and only theirs.
//
// `isCustomer`, not `optionalAuth`. A guest's recent searches live on their
// device: there is no anonymous identity here to key a row on, so answering
// them with an empty list would claim "you have searched nothing" when in fact
// their history is simply somewhere this endpoint cannot see.
//
// Declared before `/:historyId` so the literal `history` path is never read as
// an id — and before `/` so nothing shadows it either.
// ---------------------------------------------------------------------------
router.get(
  "/history",
  isCustomer,
  validateSchema(validateGetSearchHistory),
  getSearchHistory,
);
router.delete("/history", isCustomer, clearSearchHistory);
router.delete(
  "/history/:historyId",
  isCustomer,
  validateSchema(validateDeleteSearchHistoryEntry),
  deleteSearchHistoryEntry,
);

/**
 * The chips shown before anybody has typed. Public — this is mostly for guests,
 * whose own history is on their device.
 */
router.get("/popular", getPopularSearches);

/**
 * Global search — the box at the top of the customer home screen.
 *
 * `optionalAuth` rather than no gate at all, for the same reason the customer
 * voucher routes use it: a guest must get through, but a signed-in customer's
 * `req.userId` has to be present so their saved address can stand in for
 * missing coordinates and a committed query can be remembered. With no gate,
 * `userId` is undefined even for a caller holding a perfectly good token.
 *
 * A token that *is* present still has to be valid — an expired one is a 401,
 * not a silent downgrade to the guest view.
 */
router.get(
  "/",
  optionalAuth,
  validateSchema(validateGlobalSearch),
  globalSearch,
);

module.exports = router;
