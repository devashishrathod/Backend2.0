const { asyncWrapper, sendSuccess, validateObjectId } = require("../../utils");
const { updateSubscription } = require("../../services/subscriptions");

exports.update = asyncWrapper(async (req, res) => {
  validateObjectId(req.params.id, "Subscription ID");
  const result = await updateSubscription(req.params.id, req.validatedData);
  return sendSuccess(res, 200, "Subscription updated", result);
});
