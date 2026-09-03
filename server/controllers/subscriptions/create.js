const { asyncWrapper, sendSuccess } = require("../../utils");
const { createSubscription } = require("../../services/subscriptions");

exports.create = asyncWrapper(async (req, res) => {
  const result = await createSubscription(req.validatedData);
  return sendSuccess(res, 201, "Subscription created", result);
});
