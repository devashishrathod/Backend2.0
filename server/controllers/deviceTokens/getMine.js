const { asyncWrapper, sendSuccess } = require("../../utils");
const { getMyDevices } = require("../../services/deviceTokens");

exports.getMine = asyncWrapper(async (req, res) => {
  const result = await getMyDevices(
    { userId: req.userId, role: req.role },
    req.validatedData,
  );
  return sendSuccess(res, 200, "Registered devices fetched successfully", result);
});
