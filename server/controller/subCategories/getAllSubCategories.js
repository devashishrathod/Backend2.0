const {
  asyncWrapper,
  sendSuccess,
  throwError,
  cleanJoiError,
} = require("../../utils");
const { getAllSubCategories } = require("../../service/subCategories");
const {
  validateGetAllSubCategoriesQuery,
} = require("../../validator/subCategories");

exports.getAllSubCategories = asyncWrapper(async (req, res) => {
  const { error, value } = validateGetAllSubCategoriesQuery(req.query);
  if (error) throwError(422, cleanJoiError(error));
  const result = await getAllSubCategories(value);
  return sendSuccess(res, 200, "Sub-categories fetched successfully", result);
});
