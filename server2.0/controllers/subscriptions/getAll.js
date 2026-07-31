const { asyncWrapper, sendSuccess } = require("../../utils");
const { getAllSubscriptions } = require("../../services/subscriptions");

exports.getAll = asyncWrapper(async (req, res) => {
  const result = await getAllSubscriptions(req.query);
  return sendSuccess(res, 200, "Subscriptions fetched", result);
});
