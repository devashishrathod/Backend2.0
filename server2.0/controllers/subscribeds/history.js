const { asyncWrapper, sendSuccess } = require("../../utils");
const { getSubscribedHistory } = require("../../services/subscribeds");

exports.history = asyncWrapper(async (req, res) => {
  const result = await getSubscribedHistory(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    req.validatedData,
  );
  return sendSuccess(
    res,
    200,
    "Subscription history fetched successfully",
    result,
  );
});
