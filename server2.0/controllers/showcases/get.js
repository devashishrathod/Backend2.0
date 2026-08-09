const { asyncWrapper, sendSuccess } = require("../../utils");
const { getSection } = require("../../services/showcases");

exports.get = asyncWrapper(async (req, res) => {
  const result = await getSection(req.userId, req.validatedData);
  return sendSuccess(res, 200, "Section fetched successfully.", result);
});
