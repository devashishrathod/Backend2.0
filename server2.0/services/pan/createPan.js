const PAN = require("../../models/PAN");
const User = require("../../models/User");
const Brand = require("../../models/Brand");
const { throwError } = require("../../utils");
const { ROLES, SCREENS } = require("../../constants");
const {
  BRAND_ONBOARDING_SECTION,
  BRAND_ONBOARDING_CHANGE_TYPE,
} = require("../../constants/brandOnboarding");
const { identifyPanType } = require("../../helpers/pans");
const {
  resolveOnboardingEditWindow,
  assertOnboardingEditable,
  isRemediation,
  recordRemediationUpdate,
} = require("../../helpers/brands");

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

  // Shut while an admin decision is pending, open on the first pass and again
  // after a rejection.
  const editWindow = assertOnboardingEditable(
    await resolveOnboardingEditWindow(brand),
  );
  const inRemediation = isRemediation(editWindow);

  let { pan, panType, fullName, aadhaarNumber, currentScreen, ...rest } =
    payload;

  pan = pan?.toUpperCase()?.trim();

  // Exclude this brand's own record — otherwise a vendor re-saving their own
  // PAN while fixing a rejection collides with themselves.
  const takenByAnotherBrand = await PAN.findOne({
    pan,
    isDeleted: false,
    brandId: { $ne: brandId },
  }).select("_id");
  if (takenByAnotherBrand) throwError(400, "PAN details already in use.");

  panType = panType || identifyPanType(pan);

  // Normalised values are applied last so a raw payload copy cannot override
  // them.
  const panData = {
    ...rest,
    brandId,
    pan,
    panType: panType?.toUpperCase()?.trim(),
    fullName: fullName?.trim(),
    aadhaarNumber: aadhaarNumber?.trim(),
  };

  const current = brand.PANId
    ? await PAN.findOne({ _id: brand.PANId, isDeleted: false })
    : null;

  // { brandId, pan } is uniquely indexed, so re-creating the same number would
  // fail. An unchanged number updates in place; a changed one retires the old
  // record (kept for audit) and creates a fresh one.
  let panDoc;
  let changeType = null;
  if (current && current.pan === pan) {
    changeType = BRAND_ONBOARDING_CHANGE_TYPE.UPDATED;
    panDoc = await PAN.findOneAndUpdate(
      { _id: current._id, isDeleted: false },
      { $set: panData },
      { new: true, runValidators: true },
    );
  } else {
    changeType = current
      ? BRAND_ONBOARDING_CHANGE_TYPE.REPLACED
      : BRAND_ONBOARDING_CHANGE_TYPE.UPDATED;
    panDoc = await PAN.create(panData);
    if (current) {
      await PAN.updateOne({ _id: current._id }, { $set: { isDeleted: true } });
    }
    brand.PANId = panDoc._id;
    await brand.save();
  }

  if (inRemediation) {
    // The vendor is parked on the UNDER_REVIEW screen while fixing a
    // rejection — advancing the funnel here would throw them back into it.
    await recordRemediationUpdate({
      brand,
      systemVerify: editWindow.systemVerify,
      userId: user._id,
      section: BRAND_ONBOARDING_SECTION.PAN,
      changeType,
    });
  } else {
    user.currentScreen = currentScreen || SCREENS.GST_VERIFICATION;
    await user.save();
  }

  return panDoc;
};
