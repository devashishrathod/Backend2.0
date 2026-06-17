const PAN = require("../../models/PAN");
const User = require("../../models/User");
const Brand = require("../../models/Brand");
const { throwError } = require("../../utils");
const { ROLES, SCREENS } = require("../../constants");
const { identifyPanType } = require("../../helpers/pans");

exports.createPan = async (userId, payload) => {
  const user = await User.findById(userId);
  if (!user || user.isDeleted) {
    throwError(401, "Unauthorized access. User not found.");
  }
  if (!user.isActive) {
    throwError(
      403,
      "Your account is inactive/deactivated! Please contact support.",
    );
  }
  if (user.role !== ROLES.VENDOR) {
    throwError(403, "You are not authorized to add PAN.");
  }
  const brandId = user.brandId;
  if (!brandId) throwError(400, "Brand not found for user.");

  const brand = await Brand.findById(brandId);
  if (!brand || brand.isDeleted) throwError(404, "Brand not found.");

  let {
    pan,
    panType,
    fullName,
    aadhaarNumber,
    addressDetails,
    providerTransactionId,
    providerRequestId,
    verifiedAt,
    isverified,
    currentScreen,
  } = payload;

  pan = pan?.toUpperCase()?.trim();
  const existing = await PAN.findOne({ pan, isDeleted: false });
  if (existing) throwError(400, "PAN details already in use.");

  panType = panType || identifyPanType(pan);

  const panDoc = await PAN.create({
    brandId,
    pan,
    panType: panType?.toUpperCase()?.trim(),
    fullName: fullName?.trim(),
    aadhaarNumber: aadhaarNumber?.trim(),
    addressDetails,
    providerTransactionId,
    providerRequestId,
    verifiedAt,
    isverified,
    ...payload,
  });
  brand.PANId = panDoc._id;
  await brand.save();
  user.currentScreen = currentScreen || SCREENS.GST_VERIFICATION;
  await user.save();
  return panDoc;
};
