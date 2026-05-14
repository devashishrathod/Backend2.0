const { toggleVoucherLike } = require("../../service/voucherServices");
const { asyncWrapper, sendSuccess } = require("../../utils");

exports.likeOrDislikeVoucher = asyncWrapper(async (req, res) => {
  const { voucherId } = req.params;
  const userId = req.payload?._id;
  const result = await toggleVoucherLike(userId, voucherId);
  return sendSuccess(res, 200, result.liked ? "Liked" : "Disliked", result);
});
