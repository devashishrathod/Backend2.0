const User = require("../../models/User");
const Brand = require("../../models/Brand");
const SubBrand = require("../../models/SubBrand");
const { ROLES, LOGIN_TYPES } = require("../../constants");
const { throwError } = require("../../utils");
const { sendOtp } = require("../../services/otps");
const {
  generateUniqueUserId,
  generateReferralCode,
} = require("../../helpers/users");
const {
  generateUniqueSubBrandId,
  generateSubBrandStoreId,
} = require("../../helpers/subBrands");

exports.signUpSubBrandWithWhatsapp = async (payload) => {
  let { brandId, isFirstOutlet, whatsappNumber } = payload;
  const brand = await Brand.findById(brandId);
  if (!brand || brand.isDeleted) throwError(404, "Brand not found!");

  whatsappNumber = whatsappNumber?.toLowerCase();
  let user = await User.findOne({
    whatsappNumber,
    role: ROLES.SUB_VENDOR,
    isDeleted: false,
  });
  if (user) {
    throwError(403, "Outlet/Sub-Brand is already registered with this number");
  }
  user = await User.create({
    whatsappNumber,
    role: ROLES.SUB_VENDOR,
    password: process.env.DEFAULT_PASSWORD || "Trydood@123",
    uniqueId: await generateUniqueUserId(),
    referralCode: await generateReferralCode(),
  });
  const subBrand = await SubBrand.create({
    userId: user._id,
    brandId,
    whatsappNumber,
    uniqueId: await generateUniqueSubBrandId(),
    storeId: await generateSubBrandStoreId(),
  });
  user.subBrandId = subBrand._id;
  await user.save();
  if (isFirstOutlet) {
    brand.firstSubBrandId = subBrand._id;
    await brand.save();
  }
  await sendOtp(LOGIN_TYPES.WHATSAPP, whatsappNumber);
  return user;
};
