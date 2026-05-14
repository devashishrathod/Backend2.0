const User = require("../../model/User");
const { ROLES } = require("../../constants");
const { generateReferralCode, throwError } = require("../../utils");
const { sendOtp } = require("../otpServices");
const { generateUniqueUserId, getUserByFields } = require("../userServices");

exports.loginOrSignUpWithWhatsapp = async ({
  role,
  whatsappNumber,
  fcmToken,
}) => {
  role = role || ROLES.USER;
  whatsappNumber = whatsappNumber?.toLowerCase();
  let isFirst = false;
  let user = await getUserByFields({ whatsappNumber, role });
  let subVendorUser = await getUserByFields({
    whatsappNumber,
    role: ROLES.SUB_VENDOR,
  });
  if (user && !user.isActive) {
    throwError(403, "Your account is deactivated. Please contact support.");
  }
  if (role === ROLES.SUB_VENDOR && !user) {
    throwError(404, "Sub Vendor not found! Please contact brand's vendor.");
  } else if (role === ROLES.VENDOR && subVendorUser && !user) {
    throwError(
      409,
      "You are already exists as another sub vendor with this whatsApp number.",
    );
  }
  if (!user) {
    isFirst = true;
    user = new User({
      whatsappNumber,
      role,
      uniqueId: await generateUniqueUserId(),
      referCode: generateReferralCode(6),
      fcmToken: fcmToken || null,
    });
    await user.save();
    if (role === ROLES.VENDOR) {
      const subVendorExists = await getUserByFields({
        whatsappNumber,
        role: ROLES.SUB_VENDOR,
      });
      if (!subVendorExists) {
        const subVendor = new User({
          whatsappNumber,
          role: ROLES.SUB_VENDOR,
          uniqueId: await generateUniqueUserId(),
          referCode: generateReferralCode(6),
        });
        await subVendor.save();
      }
    }
  }
  const otpResult = await sendOtp(whatsappNumber);
  if (otpResult.ApiResponse == "Fail") {
    throwError(503, "Please try again! OTP service unavailable");
  }
  return {
    isFirst,
    data: {
      result: otpResult,
      user,
    },
  };
};
