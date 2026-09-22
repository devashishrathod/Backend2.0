const { asyncWrapper, sendSuccess } = require("../../utils");
const { getVendorPromoCodes } = require("../../services/promoCodes");

/**
 * The same actor shape `POST /transactions/subscribe/preview` builds, because
 * the service resolves the brand the same way: a vendor's own, or the one an
 * admin named.
 */
exports.getForVendor = asyncWrapper(async (req, res) => {
  const result = await getVendorPromoCodes(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    req.validatedData,
  );
  return sendSuccess(res, 200, "Promo codes fetched successfully", result);
});
