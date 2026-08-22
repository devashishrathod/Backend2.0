const { asyncWrapper, sendSuccess } = require("../../utils");
const { reviewBrandVerification } = require("../../services/systemVerify");
const {
  BRAND_VERIFICATION_ACTION,
} = require("../../constants/brandVerification");

const MESSAGES = Object.freeze({
  [BRAND_VERIFICATION_ACTION.APPROVED]: "Brand approved successfully.",
  [BRAND_VERIFICATION_ACTION.REJECTED]: "Brand rejected successfully.",
  [BRAND_VERIFICATION_ACTION.REVIEWED]: "Brand marked as reviewed.",
  [BRAND_VERIFICATION_ACTION.UNREVIEWED]: "Brand marked as not reviewed.",
});

exports.reviewBrandVerification = asyncWrapper(async (req, res) => {
  const result = await reviewBrandVerification(
    req.userId,
    req.params.brandId,
    req.validatedData,
  );
  return sendSuccess(
    res,
    200,
    MESSAGES[result.action] || "Brand verification updated successfully.",
    result,
  );
});
