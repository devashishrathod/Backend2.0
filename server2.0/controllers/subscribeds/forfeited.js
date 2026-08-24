const { asyncWrapper, sendSuccess } = require("../../utils");
const { getForfeitedSubscriptions } = require("../../services/subscribeds");

exports.forfeited = asyncWrapper(async (req, res) => {
  const result = await getForfeitedSubscriptions(req.validatedData);
  return sendSuccess(
    res,
    200,
    "Forfeited subscription terms fetched successfully",
    result,
  );
});
