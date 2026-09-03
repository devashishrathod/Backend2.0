const { asyncWrapper, sendSuccess } = require("../../utils");
const {
  getVendorDebt,
  writeOffVendorDebt,
} = require("../../services/settlements");

/**
 * What a brand owes that no cycle can reach.
 *
 * Read and write are separate endpoints on purpose: *"show me the debt"* is
 * asked several times and *"forgive it"* once, and folding them together would
 * make the safe question require the dangerous permission.
 */
exports.vendorDebt = asyncWrapper(async (req, res) => {
  const result = await getVendorDebt(req, req.params.brandId);
  return sendSuccess(res, 200, "Outstanding balance fetched successfully", result);
});

/** Stop chasing it, and say so in the books. */
exports.vendorDebtWriteOff = asyncWrapper(async (req, res) => {
  const result = await writeOffVendorDebt(req, {
    brandId: req.params.brandId,
    ...req.body,
  });
  return sendSuccess(res, 200, result.message, result);
});
