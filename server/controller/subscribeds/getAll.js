const {
  asyncWrapper,
  sendSuccess,
  throwError,
  cleanJoiError,
} = require("../../utils");
const { validateGetAllSubscribedQuery } = require("../../validator/subscribed");
const { getAllSubscribed } = require("../../service/subscribedServices");

exports.getAll = asyncWrapper(async (req, res) => {
  const { error, value } = validateGetAllSubscribedQuery(req.query);
  if (error) throwError(422, cleanJoiError(error));
  const result = await getAllSubscribed(value);
  return sendSuccess(res, 200, "Subscribed plans fetched successfully", result);
});
