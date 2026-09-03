const Bank = require("../../models/Bank");
const User = require("../../models/User");
const Brand = require("../../models/Brand");
const { throwError } = require("../../utils");
const {
  ROLES,
  SCREENS,
  PRIMARY_VERIFICATION_STATUSES,
} = require("../../constants");
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

exports.createBank = async (userId, payload) => {
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
    throwError(403, "You are not authorized to add bank details.");
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

  let {
    accountNumber,
    accountHolderName,
    verificationResponse,
    verifiedAt,
    isverified,
    currentScreen,
    ...rest
  } = payload;

  accountNumber = accountNumber?.toString()?.trim();

  // Exclude this brand's own record — otherwise a vendor re-saving their own
  // account while fixing a rejection collides with themselves.
  const takenByAnotherBrand = await Bank.findOne({
    accountNumber,
    isDeleted: false,
    brandId: { $ne: brandId },
  }).select("_id");
  if (takenByAnotherBrand) {
    throwError(400, "This acoount number is already in use");
  }

  // Verified status is derived from the provider response on the server — a
  // client-supplied isverified/verifiedAt is never trusted.
  isverified = false;
  verifiedAt = null;
  if (
    verificationResponse?.success &&
    verificationResponse?.status === PRIMARY_VERIFICATION_STATUSES.SUCCESS &&
    verificationResponse?.result?.is_valid &&
    verificationResponse?.result?.recommended_action === "PROCEED"
  ) {
    isverified = true;
    verifiedAt = verificationResponse.timestamp;
  }

  const masked = accountNumber.replace(/\d(?=\d{4})/g, "*");
  const last4 = accountNumber.slice(-4);

  // Normalised and server-derived values are applied last so a raw payload
  // copy cannot override them.
  const bankData = {
    ...rest,
    brandId,
    accountNumber,
    accountHolderName: accountHolderName?.trim(),
    maskedAccountNumber: masked,
    accountLast4Digits: last4,
    verificationResponse,
    isverified,
    verifiedAt,
  };

  const current = brand.BankId
    ? await Bank.findOne({ _id: brand.BankId, isDeleted: false })
    : null;

  // An unchanged account number updates in place; a changed one retires the old
  // record (kept for audit) and creates a fresh one, so nothing is orphaned.
  let bankDoc;
  let changeType = null;
  if (current && current.accountNumber === accountNumber) {
    changeType = BRAND_ONBOARDING_CHANGE_TYPE.UPDATED;
    bankDoc = await Bank.findOneAndUpdate(
      { _id: current._id, isDeleted: false },
      { $set: bankData },
      { new: true, runValidators: true },
    );
  } else {
    changeType = current
      ? BRAND_ONBOARDING_CHANGE_TYPE.REPLACED
      : BRAND_ONBOARDING_CHANGE_TYPE.UPDATED;
    bankDoc = await Bank.create(bankData);
    if (current) {
      await Bank.updateOne({ _id: current._id }, { $set: { isDeleted: true } });
    }
    brand.BankId = bankDoc._id;
    await brand.save();
  }

  if (inRemediation) {
    // The vendor is parked on the UNDER_REVIEW screen while fixing a
    // rejection — advancing the funnel here would throw them back into it.
    await recordRemediationUpdate({
      brand,
      systemVerify: editWindow.systemVerify,
      userId: user._id,
      section: BRAND_ONBOARDING_SECTION.BANK,
      changeType,
    });
  } else {
    user.currentScreen = currentScreen || SCREENS.SYSTEM_VERIFICATION;
    await user.save();
  }

  return bankDoc;
};
