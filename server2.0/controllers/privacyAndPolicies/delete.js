const { asyncWrapper, sendSuccess } = require("../../utils");
const { deletePrivacyAndPolicy } = require("../../services/privacyAndPolicies");

exports.deletePrivacyAndPolicy = asyncWrapper(async (req, res) => {
  await deletePrivacyAndPolicy(req.params?.id);
  return sendSuccess(res, 200, "Privacy and policy deleted successfully");
});
