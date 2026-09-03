const { asyncWrapper, sendSuccess } = require("../../utils");
const { adminCancelSubscription } = require("../../services/subscribeds");

exports.cancel = asyncWrapper(async (req, res) => {
  const result = await adminCancelSubscription(
    { userId: req.userId, role: req.role },
    req.validatedData,
  );
  return sendSuccess(
    res,
    200,
    "Subscription cancelled successfully. Existing outlets and content remain intact.",
    result,
  );
});
