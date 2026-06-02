const {
  asyncWrapper,
  sendSuccess,
  throwError,
  cleanJoiError,
} = require("../../utils");
const {
  getAllTermsAndConditions,
} = require("../../services/termsAndConditions");
const {
  validateGetAllTermsAndConditionsQuery,
} = require("../../validator/termsAndConditions");

exports.getAll = asyncWrapper(async (req, res) => {
  const { error, value } = validateGetAllTermsAndConditionsQuery(req.query);
  if (error) throwError(422, cleanJoiError(error));
  const result = await getAllTermsAndConditions(value);
  return sendSuccess(res, 200, "Terms and conditions fetched", result);
});
