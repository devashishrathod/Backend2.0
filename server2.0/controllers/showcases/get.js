const { asyncWrapper, sendSuccess } = require("../../utils");
const { getSection } = require("../../services/showcases");

exports.get = asyncWrapper(async (req, res) => {
  const result = await getSection(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    req.validatedData,
  );
  return sendSuccess(res, 200, "Section fetched successfully.", result);
});
