const { asyncWrapper, sendSuccess } = require("../../utils");
const { toggleBrandAvoidance } = require("../../services/brandAvoidances");

exports.toggle = asyncWrapper(async (req, res) => {
  const result = await toggleBrandAvoidance(
    req.userId,
    req.validatedData.brandId,
  );
  return sendSuccess(
    res,
    200,
    result.avoided
      ? "Brand added to avoid list."
      : "Brand removed from avoid list.",
    result,
  );
});
