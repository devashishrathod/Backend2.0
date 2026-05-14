const { asyncWrapper, sendSuccess } = require("../../utils");
const { getUserFollowedBrands } = require("../../service/brandServices");

exports.getAllFollowBrands = asyncWrapper(async (req, res) => {
  const result = await getUserFollowedBrands(req.payload._id, req.query);
  return sendSuccess(res, 200, "Followed brands and followers", result);
});
