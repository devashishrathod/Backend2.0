const { asyncWrapper, sendSuccess } = require("../../utils");
const { createLocation } = require("../../services/locations");

exports.create = asyncWrapper(async (req, res) => {
  const result = await createLocation(req.userId, req.validatedData);
  return sendSuccess(res, 201, "Location created successfully", result);
});
