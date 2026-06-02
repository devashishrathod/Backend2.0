const { asyncWrapper, sendSuccess } = require("../../utils");
const { deleteLocation } = require("../../services/locations");

exports.deleteLocation = asyncWrapper(async (req, res) => {
  await deleteLocation(req.params?.id);
  return sendSuccess(res, 200, "Location deleted successfully");
});
