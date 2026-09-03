const { asyncWrapper, sendSuccess } = require("../../utils");
const { getAllBrandAvoidances } = require("../../services/brandAvoidances");

exports.getAll = asyncWrapper(async (req, res) => {
  const result = await getAllBrandAvoidances(req.userId, req.validatedData);
  return sendSuccess(res, 200, "Avoided brands fetched successfully.", result);
});
