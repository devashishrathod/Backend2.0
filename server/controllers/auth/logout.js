const { asyncWrapper, sendSuccess } = require("../../utils");
const { logout } = require("../../services/auth");

exports.logout = asyncWrapper(async (req, res) => {
  const result = await logout({ userId: req.userId }, req.body);
  return sendSuccess(
    res,
    200,
    result.allDevices ? "Signed out of all devices" : "Logout successful",
    result,
  );
});
