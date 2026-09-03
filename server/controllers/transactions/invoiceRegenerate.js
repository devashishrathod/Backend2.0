const { asyncWrapper, sendSuccess } = require("../../utils");
const { regenerateInvoice } = require("../../services/transactions");

exports.invoiceRegenerate = asyncWrapper(async (req, res) => {
  const result = await regenerateInvoice(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    req.validatedData,
  );
  return sendSuccess(res, 200, "Invoice re-issued successfully", result);
});
