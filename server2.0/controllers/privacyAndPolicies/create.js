const {
  asyncWrapper,
  sendSuccess,
  throwError,
  cleanJoiError,
} = require("../../utils");
const { createPrivacyAndPolicy } = require("../../services/privacyAndPolicies");
const {
  validateCreatePrivacyAndPolicy,
} = require("../../validator/privacyAndPolicies");

exports.create = asyncWrapper(async (req, res) => {
  const { error, value } = validateCreatePrivacyAndPolicy(req.body);
  if (error) throwError(422, cleanJoiError(error));
  const result = await createPrivacyAndPolicy(value);
  return sendSuccess(res, 201, "Privacy and policy created", result);
});
