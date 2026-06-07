const User = require("../../models/User");
const Brand = require("../../models/Brand");
const { throwError } = require("../../utils");
const { ROLES, BUSINESS_REGISTRATION_STATUS } = require("../../constants");

exports.updateBrand = async (userId, payload) => {
  const user = await User.findById(userId);
  if (!user || user.isDeleted) {
    throwError(401, "Unauthorized access. User not found.");
  }
  if (!user.isActive) {
    throwError(
      403,
      "Your account is currently inactive/deactivated. Please contact support for assistance.",
    );
  }
  const isVendor = user.role === ROLES.VENDOR;
  if (!isVendor) {
    throwError(403, "You are not authorized to update brand details.");
  }
  let {
    currentScreen,
    brandName,
    legalBusinessName,
    businessRegistrationStatus,
    businessEntityType,
  } = payload;
  const updateData = {};

  if (brandName) updateData.brandName = brandName.toLowerCase().trim();
  if (legalBusinessName)
    updateData.legalBusinessName = legalBusinessName.toLowerCase().trim();
  if (businessRegistrationStatus) {
    updateData.businessRegistrationStatus = businessRegistrationStatus;
  }
  if (businessEntityType) updateData.businessEntityType = businessEntityType;

  await Brand.findOneAndUpdate({ userId }, updateData, { new: true });
  if (
    updateData.businessRegistrationStatus ===
    BUSINESS_REGISTRATION_STATUS.UNREGISTERED
  ) {
    throwError(
      400,
      "Business Registration Required: To maintain a trusted and compliant marketplace, Trydood currently supports only registered businesses and brands.",
    );
  }
  user.currentScreen = currentScreen.toUpperCase().trim();
  await user.save();
  return Brand.findOne({ userId }).populate(
    "userId",
    "_id whatsappNumber currentScreen isActive",
  );
};
