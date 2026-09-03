const { asyncWrapper, sendSuccess } = require("../../utils");
const { adminGrantSubscription } = require("../../services/subscribeds");

exports.grant = asyncWrapper(async (req, res) => {
  const result = await adminGrantSubscription(
    { userId: req.userId, role: req.role },
    req.validatedData,
  );
  return sendSuccess(
    res,
    201,
    `Subscription ${result.action.toLowerCase()} applied successfully without an online payment`,
    result,
  );
});
