const { asyncWrapper, sendSuccess } = require("../../utils");
const { broadcastNotification } = require("../../services/notifications");

exports.broadcast = asyncWrapper(async (req, res) => {
  const result = await broadcastNotification(
    { userId: req.userId, role: req.role },
    req.validatedData,
  );
  return sendSuccess(
    res,
    200,
    result.dryRun
      ? "Audience resolved — nothing was sent"
      : "Notification broadcast successfully",
    result,
  );
});
