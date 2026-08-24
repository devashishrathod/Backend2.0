const { asyncWrapper, sendSuccess } = require("../../utils");
const { markNotificationsRead } = require("../../services/notifications");

exports.markRead = asyncWrapper(async (req, res) => {
  const result = await markNotificationsRead(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    req.validatedData,
  );
  return sendSuccess(res, 200, "Notifications marked as read", result);
});
