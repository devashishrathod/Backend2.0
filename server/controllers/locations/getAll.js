const { asyncWrapper, sendSuccess } = require("../../utils");
const { getAllLocations } = require("../../services/locations");

exports.getAll = asyncWrapper(async (req, res) => {
  const result = await getAllLocations(req.validatedData);
  return sendSuccess(res, 200, "Locations fetched successfully", result);
});
