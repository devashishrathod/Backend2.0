const User = require("../../models/User");
const Brand = require("../../models/Brand");
const Customer = require("../../models/Customer");
const { ROLES, LOGIN_TYPES } = require("../../constants");
const { throwError } = require("../../utils");
const { sendOtp } = require("../../services/otps");
const { generateUniqueCustomerId } = require("../../helpers/customers");
const {
  generateUniqueUserId,
  generateReferralCode,
} = require("../../helpers/users");
const {
  generateUniqueBrandId,
  generateBrandMerchantId,
} = require("../../helpers/brands");

exports.loginOrSignUpWithWhatsapp = async (body) => {
  let { whatsappNumber, role } = body;
  role = role?.toUpperCase() || ROLES.CUSTOMER;
  whatsappNumber = whatsappNumber?.toLowerCase();
  let isFirst = false;
  let user = await User.findOne({ whatsappNumber, role, isDeleted: false });
  if (user && !user.isActive) {
    throwError(403, "Your account is deactivated. Please contact support.");
  }
  if (!user) {
    isFirst = true;
    user = await User.create({
      whatsappNumber,
      role,
      // No password. This account authenticates by OTP; giving every such user
      // the same DEFAULT_PASSWORD meant one known string logged into all of
      // them, and there was no flow to ever change it. A password is only set
      // when the user chooses one via POST /auth/set-password.
      uniqueId: await generateUniqueUserId(),
      referralCode: await generateReferralCode(),
    });
    if (role === ROLES.VENDOR) {
      const brand = await Brand.create({
        userId: user._id,
        whatsappNumber,
        uniqueId: await generateUniqueBrandId(),
        merchantId: await generateBrandMerchantId(),
      });
      user.brandId = brand._id;
    } else if (role === ROLES.CUSTOMER) {
      const customer = await Customer.create({
        userId: user._id,
        whatsappNumber,
        uniqueId: await generateUniqueCustomerId(),
      });
      user.customerId = customer._id;
    }
    await user.save();
  }
  //  await sendOtp(LOGIN_TYPES.WHATSAPP, whatsappNumber);
  return { isFirst, user };
};
