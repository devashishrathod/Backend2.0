const {
  asyncWrapper,
  sendSuccess,
  throwError,
  validateObjectId,
} = require("../../utils");
const { deleteSubscription } = require("../../services/subscriptions");

exports.deleteSubscription = asyncWrapper(async (req, res) => {
  validateObjectId(req.params.id, "Subscription ID");
  await deleteSubscription(req.params.id);
  return sendSuccess(res, 200, "Subscription deleted");
});
