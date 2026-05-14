const { sendSuccess, asyncWrapper } = require("../../utils");
const { toggleBrandFollow } = require("../../service/brandServices");

exports.followOrUnFollowBrand = asyncWrapper(async (req, res) => {
  const { brandId } = req.params;
  const userId = req.payload?._id;
  const result = await toggleBrandFollow(userId, brandId);
  return sendSuccess(res, 200, result.followed ? "Follow" : "Unfollow", result);
});
