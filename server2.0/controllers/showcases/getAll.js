const { asyncWrapper, sendSuccess } = require("../../utils");
const { getAllSections } = require("../../services/showcases");

exports.getAll = asyncWrapper(async (req, res) => {
  const result = await getAllSections(req.userId, req.validatedData);
  return sendSuccess(
    res,
    200,
    "Showcase sections fetched successfully.",
    result,
  );
});
