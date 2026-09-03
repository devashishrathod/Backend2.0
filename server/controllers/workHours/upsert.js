const { asyncWrapper, sendSuccess } = require("../../utils");
const { upsertWorkHours } = require("../../services/workHours");

exports.upsert = asyncWrapper(async (req, res) => {
  const result = await upsertWorkHours(req.userId, req.validatedData);
  return sendSuccess(res, 201, "WorkHours upserted successfully", result);
});
