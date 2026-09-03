const { asyncWrapper, sendSuccess } = require("../../utils");
const { updateSetting } = require("../../services/settings");

exports.update = asyncWrapper(async (req, res) => {
  const result = await updateSetting(req.userId, req.validatedData);
  return sendSuccess(res, 200, "Settings updated successfully.", result);
});
