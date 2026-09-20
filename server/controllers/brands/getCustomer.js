const { asyncWrapper, sendSuccess } = require("../../utils");
const { getCustomerBrand } = require("../../services/brands");

exports.getCustomer = asyncWrapper(async (req, res) => {
  /**
   * `req.customerId` rather than `req` — a service does not see the request.
   *
   * ⚠️ Despite the name it is a populated Customer **document**, not an id, so
   * it is handed down whole and normalised by `resolveCustomerId` at the point
   * of use. On this route it is simply absent for a guest, which is a valid
   * caller: `optionalAuth` lets them through and they get both flags `false`.
   */
  const result = await getCustomerBrand(req.validatedData, req.customerId);
  return sendSuccess(res, 200, "Brand details fetched successfully", result);
});
