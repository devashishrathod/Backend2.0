const { asyncWrapper, sendSuccess } = require("../../utils");
const { registerDeviceToken } = require("../../services/deviceTokens");

exports.register = asyncWrapper(async (req, res) => {
  const result = await registerDeviceToken(
    { userId: req.userId, role: req.role },
    req.validatedData,
  );
  return sendSuccess(res, 200, "Device registered for push notifications", result);
});
