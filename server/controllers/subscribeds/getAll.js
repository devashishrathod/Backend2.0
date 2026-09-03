const { asyncWrapper, sendSuccess } = require("../../utils");
const { getAllSubscribeds } = require("../../services/subscribeds");

exports.getAll = asyncWrapper(async (req, res) => {
  const result = await getAllSubscribeds(req.validatedData);
  return sendSuccess(res, 200, "Subscriptions fetched successfully", result);
});
