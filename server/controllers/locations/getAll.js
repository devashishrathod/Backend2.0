const { asyncWrapper, sendSuccess } = require("../../utils");
const { getAllLocations } = require("../../services/locations");

exports.getAll = asyncWrapper(async (req, res) => {
  const result = await getAllLocations(
    {
      userId: req.userId,
      role: req.role,
      brandId: req.brandId,
      subBrandId: req.subBrandId,
    },
    req.validatedData,
  );
  return sendSuccess(res, 200, "Locations fetched successfully", result);
});
