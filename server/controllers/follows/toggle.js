const { asyncWrapper, sendSuccess } = require("../../utils");
const { toggleFollow } = require("../../services/follows");

exports.toggle = asyncWrapper(async (req, res) => {
  const result = await toggleFollow(req.userId, req.validatedData.brandId);
  return sendSuccess(
    res,
    200,
    result.followed
      ? "Brand followed successfully."
      : "Brand unfollowed successfully.",
    result,
  );
});
