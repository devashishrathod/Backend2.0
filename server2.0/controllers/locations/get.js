const { asyncWrapper, sendSuccess } = require("../../utils");
const { getLocation } = require("../../services/locations");

exports.get = asyncWrapper(async (req, res) => {
  const result = await getLocation(req.params?.id);
  return sendSuccess(res, 200, "Location fetched successfully", result);
});
