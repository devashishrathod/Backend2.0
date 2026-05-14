const { asyncWrapper, sendSuccess } = require("../../utils");
const { toggleBrandStatus } = require("../../service/brandServices");

exports.activeOrInactiveBrand = asyncWrapper(async (req, res, next) => {
  const userId = req.payload?._id;
  const { brandId } = req.params;
  const updated = await toggleBrandStatus(userId, brandId);
  return sendSuccess(
    res,
    200,
    `Brand is now ${updated.isActive ? "Active" : "Inactive"}`,
    updated
  );
});
