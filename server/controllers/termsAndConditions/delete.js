const { asyncWrapper, sendSuccess } = require("../../utils");
const { deleteTermAndCondition } = require("../../services/termsAndConditions");

exports.deleteTermAndCondition = asyncWrapper(async (req, res) => {
  await deleteTermAndCondition(req.params?.id);
  return sendSuccess(res, 200, "Term and condition deleted successfully");
});
