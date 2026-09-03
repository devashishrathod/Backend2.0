const GST = require("../../models/GST");
const User = require("../../models/User");
const Brand = require("../../models/Brand");
const { throwError } = require("../../utils");
const { ROLES, SCREENS } = require("../../constants");
const {
  BRAND_ONBOARDING_SECTION,
  BRAND_ONBOARDING_CHANGE_TYPE,
} = require("../../constants/brandOnboarding");
const {
  resolveOnboardingEditWindow,
  assertOnboardingEditable,
  isRemediation,
  recordRemediationUpdate,
} = require("../../helpers/brands");

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

  // Shut while an admin decision is pending, open on the first pass and again
  // after a rejection.
  const editWindow = assertOnboardingEditable(
    await resolveOnboardingEditWindow(brand),
  );
  const inRemediation = isRemediation(editWindow);

  let { gstNumber, legalName, currentScreen, ...rest } = payload;

  gstNumber = gstNumber?.toUpperCase()?.trim();

  // Exclude this brand's own record — otherwise a vendor re-saving their own
  // GST while fixing a rejection collides with themselves.
  const takenByAnotherBrand = await GST.findOne({
    gstNumber,
    isDeleted: false,
    brandId: { $ne: brandId },
  }).select("_id");
  if (takenByAnotherBrand) throwError(400, "GST detials already in use.");

  // Normalised values are applied last so a raw payload copy cannot override
  // them.
  const gstData = {
    ...rest,
    brandId,
    gstNumber,
    legalName: legalName?.trim(),
  };

  const current = brand.GSTId
    ? await GST.findOne({ _id: brand.GSTId, isDeleted: false })
    : null;

  // { brandId, gstNumber } is uniquely indexed, so re-creating the same number
  // would fail. An unchanged number updates in place; a changed one retires the
  // old record (kept for audit) and creates a fresh one.
  let gstDoc;
  let changeType = null;
  if (current && current.gstNumber === gstNumber) {
    changeType = BRAND_ONBOARDING_CHANGE_TYPE.UPDATED;
    gstDoc = await GST.findOneAndUpdate(
      { _id: current._id, isDeleted: false },
      { $set: gstData },
      { new: true, runValidators: true },
    );
  } else {
    changeType = current
      ? BRAND_ONBOARDING_CHANGE_TYPE.REPLACED
      : BRAND_ONBOARDING_CHANGE_TYPE.UPDATED;
    gstDoc = await GST.create(gstData);
    if (current) {
      await GST.updateOne({ _id: current._id }, { $set: { isDeleted: true } });
    }
    brand.GSTId = gstDoc._id;
    await brand.save();
  }

  if (inRemediation) {
    // The vendor is parked on the UNDER_REVIEW screen while fixing a
    // rejection — advancing the funnel here would throw them back into it.
    await recordRemediationUpdate({
      brand,
      systemVerify: editWindow.systemVerify,
      userId: user._id,
      section: BRAND_ONBOARDING_SECTION.GST,
      changeType,
    });
  } else {
    user.currentScreen = currentScreen || SCREENS.BANK_VERIFICATION;
    await user.save();
  }

  return gstDoc;
};
