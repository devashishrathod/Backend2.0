const {
  asyncWrapper,
  sendSuccess,
  throwError,
  cleanJoiError,
} = require("../../utils");
const {
  validateUpdateTermAndCondition,
} = require("../../validator/termsAndConditions");
const { updateTermAndCondition } = require("../../services/termsAndConditions");

exports.update = asyncWrapper(async (req, res) => {
  const { error, value } = validateUpdateTermAndCondition(req.body);
  if (error) throwError(422, cleanJoiError(error));
  const updated = await updateTermAndCondition(req.params?.id, value);
  return sendSuccess(res, 200, "Term and condition updated", updated);
});
