const { asyncWrapper, sendSuccess } = require("../../utils");
const { getAllCustomerBrands } = require("../../services/brands");

exports.getAllCustomer = asyncWrapper(async (req, res) => {
  // `req.customerId` is a populated Customer document, not an id — see the note
  // in `controllers/brands/getCustomer.js`. Absent for a guest, which is a valid
  // caller on this route.
  const result = await getAllCustomerBrands(req.validatedData, req.customerId);
  return sendSuccess(res, 200, "Brands fetched successfully", result);
});
