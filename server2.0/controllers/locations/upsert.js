const { asyncWrapper, sendSuccess } = require("../../utils");
const { upsertLocation } = require("../../services/locations");

exports.upsert = asyncWrapper(async (req, res) => {
  const result = await upsertLocation(req.userId, req.validatedData);
  return sendSuccess(res, 201, "Location upserted successfully", result);
});
