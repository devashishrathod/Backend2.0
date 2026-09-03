const { asyncWrapper, sendSuccess } = require("../../utils");
const { verifyVendor } = require("../../services/systemVerify");

exports.verifyBrand = asyncWrapper(async (req, res) => {
  const result = await verifyVendor(req.userId);
  return sendSuccess(res, 200, "Brand's vendor verified successfully.", result);
});
