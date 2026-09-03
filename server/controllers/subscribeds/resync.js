const { asyncWrapper, sendSuccess } = require("../../utils");
const { resyncBrandSubscription } = require("../../services/subscribeds");

exports.resync = asyncWrapper(async (req, res) => {
  const result = await resyncBrandSubscription(req.validatedData);
  return sendSuccess(
    res,
    200,
    "Brand subscription state and plan limits resynced successfully",
    result,
  );
});
