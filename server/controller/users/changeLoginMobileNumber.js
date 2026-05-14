const { sendOtp } = require("../../service/otpServices");
const { sendSuccess, sendError, asyncWrapper } = require("../../utils");
const { getUserByFields } = require("../../service/userServices");
const {
  getSubBrandByFields,
  getSubBrandById,
} = require("../../service/subBrandServices");
// const { ROLES } = require("../../constants");

exports.changeLoginMobileNumber = asyncWrapper(async (req, res) => {
  const user = req?.payload;
  const previousMobile = user?.whatsappNumber;
  let { whatsappNumber, subBrandId, role } = req.body;
  if (previousMobile == whatsappNumber) {
    return sendError(
      res,
      400,
      "You have already registered with this mobile number"
    );
  }
  whatsappNumber = whatsappNumber?.toLowerCase();
  const checkUser = await getUserByFields({ whatsappNumber, role });
  if (checkUser) {
    return sendError(
      res,
      400,
      `User already exist with ${whatsappNumber} as ${role}! Please choose a different number`
    );
  }
  // else if (role === ROLES.SUB_VENDOR) {
  // }
  if (subBrandId) {
    const checksubBrand = await getSubBrandById(subBrandId);
    if (!checksubBrand) {
      return sendError(res, 404, "No sub-brand/outlet found!");
    }
    const existingSubBrandWithMobile = await getSubBrandByFields({
      whatsappNumber: whatsappNumber.toLowerCase(),
    });
    if (existingSubBrandWithMobile) {
      return sendError(
        res,
        404,
        "Sub-brand already exist with this mobile number."
      );
    }
  }
  const result = await sendOtp(whatsappNumber);
  if (result.ApiResponse == "Fail") {
    return sendError(res, 503, "Please try again! OTP service unavailable");
  }
  return sendSuccess(res, 200, "OTP sent to your mobile number successfully.", {
    result,
    user: checkUser,
  });
});
