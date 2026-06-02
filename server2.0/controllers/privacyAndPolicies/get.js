const { asyncWrapper, sendSuccess } = require("../../utils");
const { getPrivacyAndPolicy } = require("../../services/privacyAndPolicies");

exports.get = asyncWrapper(async (req, res) => {
  const result = await getPrivacyAndPolicy(req.params?.id);
  return sendSuccess(res, 200, "Privacy and policy fetched", result);
});
