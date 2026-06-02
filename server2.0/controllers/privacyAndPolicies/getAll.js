const {
  asyncWrapper,
  sendSuccess,
  throwError,
  cleanJoiError,
} = require("../../utils");
const {
  getAllPrivacyAndPolicies,
} = require("../../services/privacyAndPolicies");
const {
  validateGetAllPrivacyAndPoliciesQuery,
} = require("../../validator/privacyAndPolicies");

exports.getAll = asyncWrapper(async (req, res) => {
  const { error, value } = validateGetAllPrivacyAndPoliciesQuery(req.query);
  if (error) throwError(422, cleanJoiError(error));
  const result = await getAllPrivacyAndPolicies(value);
  return sendSuccess(res, 200, "Privacys and policies fetched", result);
});
