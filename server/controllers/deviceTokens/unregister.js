const { asyncWrapper, sendSuccess } = require("../../utils");
const { unregisterDeviceToken } = require("../../services/deviceTokens");

exports.unregister = asyncWrapper(async (req, res) => {
  const result = await unregisterDeviceToken(
    { userId: req.userId, role: req.role },
    req.validatedData,
  );
  return sendSuccess(res, 200, "Device unregistered from push notifications", result);
});
