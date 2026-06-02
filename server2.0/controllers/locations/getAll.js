const {
  asyncWrapper,
  sendSuccess,
  throwError,
  cleanJoiError,
} = require("../../utils");
const { getAllLocations } = require("../../services/locations");
const { validateGetAllLocationsQuery } = require("../../validator/locations");

exports.getAll = asyncWrapper(async (req, res) => {
  const { error } = validateGetAllLocationsQuery(req.query);
  if (error) throwError(422, cleanJoiError(error));
  const result = await getAllLocations(req.query);
  return sendSuccess(res, 200, "Locations fetched successfully", result);
});
