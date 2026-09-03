const {
  asyncWrapper,
  sendSuccess,
  throwError,
  validateObjectId,
} = require("../../utils");
const { getSubscription } = require("../../services/subscriptions");

exports.get = asyncWrapper(async (req, res) => {
  validateObjectId(req.params.id, "Subscription ID");
  const subscription = await getSubscription(req.params.id);
  return sendSuccess(res, 200, "Subscription fetched", subscription);
});
