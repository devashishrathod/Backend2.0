const { asyncWrapper, sendSuccess } = require("../../utils");
const { getSetting } = require("../../services/settings");

exports.get = asyncWrapper(async (req, res) => {
  const result = await getSetting();
  return sendSuccess(res, 200, "Settings fetched successfully.", result);
});
