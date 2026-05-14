const {
  asyncWrapper,
  sendSuccess,
  throwError,
  cleanJoiError,
} = require("../../utils");
const { getAllLessAmount } = require("../../service/lessAmountServices");
const {
  validateGetAllLessAmountQuery,
} = require("../../validator/validate.lessAmount");

exports.getAll = asyncWrapper(async (req, res) => {
  const { error, value } = validateGetAllLessAmountQuery(req.query);
  if (error) throwError(422, cleanJoiError(error));
  const result = await getAllLessAmount(value);
  return sendSuccess(res, 200, "LessAmount fetched successfully", result);
});
