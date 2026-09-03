const { asyncWrapper, sendSuccess } = require("../../utils");
const { sendTestPush } = require("../../services/deviceTokens");

exports.testPush = asyncWrapper(async (req, res) => {
  const result = await sendTestPush(
    { userId: req.userId, role: req.role },
    req.validatedData,
  );
  return sendSuccess(res, 200, "Test push dispatched", result);
});
