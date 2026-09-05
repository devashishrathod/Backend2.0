const { asyncWrapper, sendSuccess } = require("../../utils");
const { getAppConfig } = require("../../services/appConfig");

exports.getConfig = asyncWrapper(async (req, res) => {
  const result = await getAppConfig(req.validatedData);
  return sendSuccess(res, 200, "App config fetched successfully", result);
});
