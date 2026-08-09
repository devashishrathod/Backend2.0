const { asyncWrapper, sendSuccess } = require("../../utils");
const { createSection } = require("../../services/showcases");

exports.create = asyncWrapper(async (req, res) => {
  const result = await createSection(req.userId, req.validatedData);
  return sendSuccess(
    res,
    201,
    "Showcase section created successfully.",
    result,
  );
});
