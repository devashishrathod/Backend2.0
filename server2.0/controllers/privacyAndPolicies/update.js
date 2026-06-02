const {
  asyncWrapper,
  sendSuccess,
  throwError,
  cleanJoiError,
} = require("../../utils");
const {
  validateUpdatePrivacyAndPolicy,
} = require("../../validator/privacyAndPolicies");
const { updatePrivacyAndPolicy } = require("../../services/privacyAndPolicies");

exports.update = asyncWrapper(async (req, res) => {
  const { error, value } = validateUpdatePrivacyAndPolicy(req.body);
  if (error) throwError(422, cleanJoiError(error));
  const updated = await updatePrivacyAndPolicy(req.params?.id, value);
  return sendSuccess(res, 200, "Privacy and policy updated", updated);
});
