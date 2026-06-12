const Bank = require("../../models/Bank");
const User = require("../../models/User");
const Brand = require("../../models/Brand");
const { throwError } = require("../../utils");
const {
  ROLES,
  SCREENS,
  PRIMARY_VERIFICATION_STATUSES,
} = require("../../constants");

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
    throwError(403, "You are not authorized to add GST details.");
  }
  const brandId = user.brandId;
  if (!brandId) throwError(400, "Brand not found for user.");

  const brand = await Brand.findById(brandId);
  if (!brand || brand.isDeleted) throwError(404, "Brand not found.");

  let {
    accountNumber,
    accountHolderName,
    ifscCode,
    isValid,
    recommendedAction,
    accountType,
    verificationResponse,
    providerTransactionId,
    providerRequestId,
    verifiedAt,
    isverified,
    currentScreen,
  } = payload;

  const existing = await Bank.findOne({ accountNumber, isDeleted: false });
  if (existing) throwError(400, "This acoount number is already in use");

  if (
    verificationResponse.success &&
    verificationResponse.status === PRIMARY_VERIFICATION_STATUSES.SUCCESS &&
    verificationResponse.result.is_valid &&
    verificationResponse.result.recommended_action === "PROCEED"
  ) {
    isverified = true;
    verifiedAt = verificationResponse.timestamp;
  }

  const acct = (accountNumber || "").toString();
  const masked = acct.replace(/\d(?=\d{4})/g, "*");
  const last4 = acct.slice(-4);

  const bankDoc = await Bank.create({
    brandId,
    accountHolderName,
    accountNumber,
    maskedAccountNumber: masked,
    accountLast4Digits: last4,
    ifscCode,
    recommendedAction,
    accountType,
    providerTransactionId,
    providerRequestId,
    ...payload,
  });

  brand.BankId = bankDoc._id;
  await brand.save();
  user.currentScreen = currentScreen || SCREENS.SYSTEM_VERIFICATION;
  await user.save();
  return bankDoc;
};
