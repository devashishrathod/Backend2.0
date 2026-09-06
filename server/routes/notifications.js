const express = require("express");
const router = express.Router();

const {
  validateSchema,
  isAdmin,
  verifyJwtToken,
  verifyJwtTokenEvenIfDeactivated,
} = require("../middlewares");
const {
  getAll,
  markRead,
  broadcast,
  getMyPreferences,
  updateMyPreferences,
  getPreferencesForUser,
  updatePreferencesForUser,
} = require("../controllers/notifications");
const {
  validateGetAllNotifications,
  validateMarkNotificationsRead,
  validateBroadcastNotification,
  validateUpdateMyNotificationPreferences,
  validateGetUserNotificationPreferences,
  validateUpdateUserNotificationPreferences,
} = require("../validator/notifications");

// ---------------------------------------------------------------------------
// One endpoint, four shapes — scope and projection both come from the token.
//
// A customer reads their own rows, a vendor their brand's, an admin either the
// admin feed or any brand's, and an outlet manager is refused with a reason.
// All of it in `services/notifications/notificationScope.js`, shared by the read
// and the write so the two cannot disagree about who may touch which row.
//
// ⚠️ The gate widened from `isVendorOrAdmin` to `verifyJwtToken` when the
// customer feed was added. That is only safe because the scope narrows **by
// role before any caller-supplied `brandId` is read** — a customer never reaches
// `resolveActorBrand` at all. Putting a role gate back here would not make it
// safer; it would just move the decision somewhere it has to be repeated.
// ---------------------------------------------------------------------------

// Deliberately reachable by a deactivated account — read-only, and scoped to the
// caller's own feed. This is where the notice explaining the suspension lands,
// so refusing it would leave a vendor locked out with no in-app explanation.
// `mark-read` below is not exempt: it is a write, and a suspended account has no
// business writing.
router.get(
  "/get-all",
  verifyJwtTokenEvenIfDeactivated,
  validateSchema(validateGetAllNotifications),
  getAll,
);
router.put(
  "/mark-read",
  verifyJwtToken,
  validateSchema(validateMarkNotificationsRead),
  markRead,
);

// ---------------------------------------------------------------------------
// Channel toggles — email, push and WhatsApp, independently, per person.
//
// `verifyJwtToken` and no role gate, deliberately: a customer, a vendor, an
// outlet manager and an admin all have exactly one `User`, so "my preferences"
// is the same operation for every one of them and the service reads the id off
// the token rather than off the body. A role branch here would be four copies
// of one thing.
//
// ⚠️ Declared **before** the `/admin/...` pair so neither literal path can be
// read as the other, and so the self-service route is never reachable with a
// caller-supplied id — this endpoint has no way to address anybody else.
// ---------------------------------------------------------------------------
router.get("/preferences", verifyJwtToken, getMyPreferences);
router.put(
  "/preferences",
  verifyJwtToken,
  validateSchema(validateUpdateMyNotificationPreferences),
  updateMyPreferences,
);

/**
 * Admin — read and set anybody's, from their profile card.
 *
 * Addressed by `userId`, `customerId` **or** `brandId`, whichever the screen
 * holds. Admin-only because switching another person's notifications off is a
 * change they cannot see having been made to them, and `updatedBy` records who
 * did it.
 *
 * ⚠️ This writes the **person's** preference, never the platform toggle. Turning
 * one customer's WhatsApp on does not turn WhatsApp on for every customer — that
 * lives in `PUT /settings`, and the response says so via `blockedBy: "PLATFORM"`
 * when the platform switch is what is actually holding a channel shut.
 */
router.get(
  "/admin/preferences",
  isAdmin,
  validateSchema(validateGetUserNotificationPreferences),
  getPreferencesForUser,
);
router.put(
  "/admin/preferences",
  isAdmin,
  validateSchema(validateUpdateUserNotificationPreferences),
  updatePreferencesForUser,
);

// Admin only: this can reach every user on the platform.
router.post(
  "/broadcast",
  isAdmin,
  validateSchema(validateBroadcastNotification),
  broadcast,
);

module.exports = router;
