const { asyncWrapper, sendSuccess } = require("../../utils");
const {
  getMyNotificationPreferences,
  updateMyNotificationPreferences,
  getUserNotificationPreferences,
  updateUserNotificationPreferences,
} = require("../../services/notifications");

/**
 * Notification channel toggles — the caller's own, and an admin's view of
 * anybody's.
 *
 * ⚠️ Four handlers in one file because they are one feature with one response
 * shape. Splitting them would put the "mine" and "theirs" versions of the same
 * screen in different places, which is how the two drift.
 */

/** Whoever is holding the token — customer, vendor, outlet manager or admin. */
exports.getMyPreferences = asyncWrapper(async (req, res) => {
  const result = await getMyNotificationPreferences({ userId: req.userId });
  return sendSuccess(
    res,
    200,
    "Notification preferences fetched successfully",
    result,
  );
});

exports.updateMyPreferences = asyncWrapper(async (req, res) => {
  const result = await updateMyNotificationPreferences(
    { userId: req.userId },
    req.validatedData,
  );
  return sendSuccess(
    res,
    200,
    "Notification preferences updated successfully",
    result,
  );
});

/**
 * Admin, by `userId`, `customerId` or `brandId` — whichever id the screen they
 * are on actually holds.
 */
exports.getPreferencesForUser = asyncWrapper(async (req, res) => {
  const result = await getUserNotificationPreferences(req.validatedData);
  return sendSuccess(
    res,
    200,
    "Notification preferences fetched successfully",
    result,
  );
});

exports.updatePreferencesForUser = asyncWrapper(async (req, res) => {
  const result = await updateUserNotificationPreferences(
    // Stamped onto the record as `updatedBy`, so "why did I stop getting
    // emails?" has an answer with a name on it.
    { userId: req.userId },
    req.validatedData,
  );
  return sendSuccess(
    res,
    200,
    "Notification preferences updated successfully",
    result,
  );
});
