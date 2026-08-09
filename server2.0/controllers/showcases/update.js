const { asyncWrapper, sendSuccess } = require("../../utils");
const { updateSection } = require("../../services/showcases");

exports.update = asyncWrapper(async (req, res) => {
  const result = await updateSection(req.validatedData);
  return sendSuccess(res, 200, "Section updated successfully.", result);
});
