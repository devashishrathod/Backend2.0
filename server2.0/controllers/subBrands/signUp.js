const { asyncWrapper, sendSuccess } = require("../../utils");
const { signUpSubBrandWithWhatsapp } = require("../../services/subBrands");

exports.signUp = asyncWrapper(async (req, res) => {
  const result = await signUpSubBrandWithWhatsapp(
    { userId: req.userId, role: req.role, brandId: req.brandId },
    req.validatedData,
  );
  return sendSuccess(
    res,
    200,
    "OTP sent to subBrand whatsapp number successfully.",
    result,
  );
});
