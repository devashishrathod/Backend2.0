const { asyncWrapper, sendSuccess } = require("../../utils");
const { deleteLocation } = require("../../services/locations");

exports.deleteLocation = asyncWrapper(async (req, res) => {
  await deleteLocation(
    {
      userId: req.userId,
      role: req.role,
      brandId: req.brandId,
      subBrandId: req.subBrandId,
    },
    req.validatedData,
  );
  return sendSuccess(res, 200, "Location deleted successfully");
});
