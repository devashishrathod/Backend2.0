const { asyncWrapper, sendSuccess } = require("../../utils");
const { getAllFollowedBrands } = require("../../services/follows");

exports.getAll = asyncWrapper(async (req, res) => {
  const result = await getAllFollowedBrands(req.userId, req.validatedData);
  return sendSuccess(res, 200, "Followed brands fetched successfully.", result);
});
