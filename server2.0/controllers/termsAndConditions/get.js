const { asyncWrapper, sendSuccess } = require("../../utils");
const { getTermAndCondition } = require("../../services/termsAndConditions");

exports.get = asyncWrapper(async (req, res) => {
  const result = await getTermAndCondition(req.params?.id);
  return sendSuccess(res, 200, "Term and condition fetched", result);
});
