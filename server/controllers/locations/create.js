const { asyncWrapper, sendSuccess } = require("../../utils");
const { createLocation } = require("../../services/locations");

exports.create = asyncWrapper(async (req, res) => {
  const result = await createLocation(
    {
      userId: req.userId,
      role: req.role,
      brandId: req.brandId,
      subBrandId: req.subBrandId,
    },
    req.validatedData,
  );
  return sendSuccess(res, 201, "Location created successfully", result);
});
