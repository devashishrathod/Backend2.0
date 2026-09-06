const { asyncWrapper, sendSuccess } = require("../../utils");
const { markNotificationsRead } = require("../../services/notifications");

exports.markRead = asyncWrapper(async (req, res) => {
  const result = await markNotificationsRead(
    // `customerId` included for the same reason as in `getAll` — the shared
    // scope builder needs it, and omitting it fails as a refusal, not an error.
    {
      userId: req.userId,
      role: req.role,
      brandId: req.brandId,
      customerId: req.customerId,
    },
    req.validatedData,
  );
  return sendSuccess(res, 200, "Notifications marked as read", result);
});
