const { asyncWrapper, sendSuccess } = require("../../utils");
const { getCustomerPromoCodes } = require("../../services/promoCodes");

/**
 * The whole request is passed as the actor, not `req.customerId`.
 *
 * `req.customerId` is a populated **document**, and the service needs both the
 * id and the identity for `buildClaimPreview`. `resolveCustomerId` untangles it
 * there; a controller reaching in to do that itself is how the
 * `String(req.customerId)` bug gets written again.
 */
exports.getForCustomer = asyncWrapper(async (req, res) => {
  const result = await getCustomerPromoCodes(req, req.validatedData);
  return sendSuccess(res, 200, "Promo codes fetched successfully", result);
});
