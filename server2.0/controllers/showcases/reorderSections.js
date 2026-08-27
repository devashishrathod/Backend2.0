const { asyncWrapper, sendSuccess } = require("../../utils");
const { reorderAllSections } = require("../../services/showcases");

exports.reorderSections = asyncWrapper(async (req, res) => {
  const result = await reorderAllSections(
    { userId: req.userId, role: req.role, brandId: req.brandId }, req.validatedData);
  return sendSuccess(res, 200, "Sections reordered successfully.", result);
});
