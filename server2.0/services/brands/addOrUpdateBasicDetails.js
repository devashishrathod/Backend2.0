const User = require("../../models/User");
const Brand = require("../../models/Brand");
const { throwError } = require("../../utils");
const { ROLES, BUSINESS_REGISTRATION_STATUS } = require("../../constants");
const { BRAND_ONBOARDING_SECTION } = require("../../constants/brandOnboarding");
const {
  resolveOnboardingEditWindow,
  assertOnboardingEditable,
  isRemediation,
  recordRemediationUpdate,
} = require("../../helpers/brands");

exports.addOrUpdateBasicDetails = async (userId, payload) => {
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

  const brand = await Brand.findOne({ userId, isDeleted: false });
  if (!brand) throwError(404, "Brand not found.");

  // Shut while an admin decision is pending, open on the first pass and again
  // after a rejection.
  const editWindow = assertOnboardingEditable(
    await resolveOnboardingEditWindow(brand),
  );
  const inRemediation = isRemediation(editWindow);

  let {
    currentScreen,
    brandName,
    legalBusinessName,
    businessRegistrationStatus,
    businessEntityType,
  } = payload;

  // While fixing a rejection the vendor may correct their names and entity
  // type; registration status is read-only there, since UNREGISTERED is
  // refused outright and REGISTERED is the only value that gets this far.
  if (inRemediation && businessRegistrationStatus) {
    throwError(
      400,
      "Business registration status cannot be changed. Please contact support if it needs correcting.",
    );
  }

  const updateData = {};
  if (brandName) updateData.brandName = brandName.toLowerCase().trim();
  if (legalBusinessName) {
    updateData.legalBusinessName = legalBusinessName.toLowerCase().trim();
  }
  if (!inRemediation && businessRegistrationStatus) {
    updateData.businessRegistrationStatus = businessRegistrationStatus;
  }
  if (businessEntityType) updateData.businessEntityType = businessEntityType;

  if (!Object.keys(updateData).length) {
    throwError(400, "Please provide at least one detail to update.");
  }

  await Brand.updateOne(
    { _id: brand._id, isDeleted: false },
    { $set: updateData },
  );

  if (
    updateData.businessRegistrationStatus ===
    BUSINESS_REGISTRATION_STATUS.UNREGISTERED
  ) {
    throwError(
      400,
      "Business Registration Required: To maintain a trusted and compliant marketplace, Trydood currently supports only registered businesses and brands.",
    );
  }

  if (inRemediation) {
    // The vendor is parked on the UNDER_REVIEW screen while fixing a
    // rejection — advancing the funnel here would throw them back into it.
    await recordRemediationUpdate({
      brand,
      systemVerify: editWindow.systemVerify,
      userId: user._id,
      section: BRAND_ONBOARDING_SECTION.BASIC_DETAILS,
      details: { fields: Object.keys(updateData) },
    });
  } else if (currentScreen) {
    user.currentScreen = currentScreen.toUpperCase().trim();
    await user.save();
  }

  return Brand.findById(brand._id).populate(
    "userId",
    "_id whatsappNumber currentScreen isActive",
  );
};
