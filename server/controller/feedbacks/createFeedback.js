const { createReview } = require("../../service/feedbackServices");
const { asyncWrapper, sendSuccess } = require("../../utils");

exports.createFeedback = asyncWrapper(async (req, res, next) => {
  const userId = req.payload?._id;
  const brandId = req.params.brandId;
  const { voucherId, rating, review } = req.body;
  const images = req.files?.images;
  const result = await createReview(
    userId,
    brandId,
    voucherId,
    Number(rating),
    review,
    images
  );
  return sendSuccess(res, 201, "Review created successfully", result);
});
