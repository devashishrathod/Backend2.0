const GST = require("../../models/GST");
const User = require("../../models/User");
const Brand = require("../../models/Brand");
const { throwError } = require("../../utils");
const { ROLES, SCREENS } = require("../../constants");

exports.createGst = async (userId, payload) => {
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
    throwError(403, "You are not authorized to add GST details.");
  }
  const brandId = user.brandId;
  if (!brandId) throwError(400, "Brand not found for user.");

  const brand = await Brand.findById(brandId);
  if (!brand || brand.isDeleted) throwError(404, "Brand not found.");

  let {
    gstNumber,
    legalName,
    constitutionOfBusiness,
    taxpayerType,
    registrationDate,
    registrationStatus,
    address,
    providerTransactionId,
    providerRequestId,
    verifiedAt,
    isverified,
    currentScreen,
  } = payload;

  gstNumber = gstNumber?.toUpperCase()?.trim();
  const existing = await GST.findOne({ brandId, gstNumber });
  if (existing) throwError(400, "GST detials already exists for this brand.");

  const gstDoc = await GST.create({
    brandId,
    gstNumber,
    legalName,
    constitutionOfBusiness,
    taxpayerType,
    registrationDate,
    registrationStatus,
    address,
    providerTransactionId,
    providerRequestId,
    verifiedAt,
    isverified,
    ...payload,
  });

  brand.GSTId = gstDoc._id;
  await brand.save();
  user.currentScreen = currentScreen || SCREENS.BANK_VERIFICATION;
  await user.save();
  return gstDoc;
};
