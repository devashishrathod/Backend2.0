const { asyncWrapper, sendSuccess } = require("../../utils");
const { updateLocation } = require("../../services/locations");

exports.update = asyncWrapper(async (req, res) => {
  const result = await updateLocation(
    {
      userId: req.userId,
      role: req.role,
      brandId: req.brandId,
      subBrandId: req.subBrandId,
    },
    req.validatedData,
  );
  return sendSuccess(res, 200, "Location updated successfully", result);
});
