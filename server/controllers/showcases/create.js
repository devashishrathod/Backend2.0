const { asyncWrapper, sendSuccess } = require("../../utils");
const { createSection } = require("../../services/showcases");

exports.create = asyncWrapper(async (req, res) => {
  const result = await createSection(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    req.validatedData,
  );
  return sendSuccess(
    res,
    201,
    "Showcase section created successfully.",
    result,
  );
});
