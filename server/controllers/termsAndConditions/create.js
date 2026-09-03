const {
  asyncWrapper,
  sendSuccess,
  throwError,
  cleanJoiError,
} = require("../../utils");
const { createTermAndCondition } = require("../../services/termsAndConditions");
const {
  validateCreateTermAndCondition,
} = require("../../validator/termsAndConditions");

exports.create = asyncWrapper(async (req, res) => {
  const { error, value } = validateCreateTermAndCondition(req.body);
  if (error) throwError(422, cleanJoiError(error));
  const result = await createTermAndCondition(value);
  return sendSuccess(res, 201, "Term and condition created", result);
});
