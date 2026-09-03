const User = require("../../models/User");
const Brand = require("../../models/Brand");
const { throwError } = require("../../utils");
const { ROLES, SCREENS } = require("../../constants");

exports.acceptPartnership = async (userId) => {
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
  const brandId = user.brandId;
  if (!brandId) throwError(400, "Brand not found for user.");

  const brand = await Brand.findById(brandId);
  if (!brand || brand.isDeleted) throwError(404, "Brand not found.");

  brand.hasAcceptedPartnershipDeed = true;
  await brand.save();
  user.currentScreen = SCREENS.SUBSCRIBE_PLAN;
  await user.save();
  return;
};
