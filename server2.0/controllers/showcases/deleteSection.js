const { asyncWrapper, sendSuccess } = require("../../utils");
const { deleteFullSection } = require("../../services/showcases");

exports.deleteSection = asyncWrapper(async (req, res) => {
  const result = await deleteFullSection(req.userId, req.validatedData);
  return sendSuccess(res, 200, "Section deleted successfully.", result);
});
