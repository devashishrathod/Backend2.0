const {
  asyncWrapper,
  sendSuccess,
  throwError,
  cleanJoiError,
} = require("../../utils");
const { validateCreateLocation } = require("../../validator/locations");
const { createLocation } = require("../../services/locations");

exports.create = asyncWrapper(async (req, res) => {
  const { error, value } = validateCreateLocation(req.body);
  if (error) throwError(422, cleanJoiError(error));
  const result = await createLocation(value);
  return sendSuccess(res, 201, "Location created successfully", result);
});
