const { asyncWrapper, sendSuccess } = require("../../utils");
const { getAllNotifications } = require("../../services/notifications");

exports.getAll = asyncWrapper(async (req, res) => {
  const result = await getAllNotifications(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    req.validatedData,
  );
  return sendSuccess(res, 200, "Notifications fetched successfully", result);
});
