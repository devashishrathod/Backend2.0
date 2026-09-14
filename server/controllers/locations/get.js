const { asyncWrapper, sendSuccess } = require("../../utils");
const { getLocation } = require("../../services/locations");

exports.get = asyncWrapper(async (req, res) => {
  const result = await getLocation(req.validatedData, {
    userId: req.userId,
    role: req.role,
    brandId: req.brandId,
    // ⚠️ Was missing, so a SUB_VENDOR reached the service with no outlet to be
    // checked against and was refused their own address — while the update and
    // list endpoints, which do pass it, let them through.
    subBrandId: req.subBrandId,
  });
  return sendSuccess(res, 200, "Location fetched successfully", result);
});
