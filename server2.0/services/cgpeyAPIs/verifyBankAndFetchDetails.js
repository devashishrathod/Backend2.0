const Bank = require("../../models/Bank");
const Brand = require("../../models/Brand");
const { fetchAPI } = require("../../helpers/cgpeyAPIs");
const { throwError } = require("../../utils");
const { PRIMARY_VERIFICATION_STATUSES } = require("../../constants");
const {
  resolveOnboardingEditWindow,
  assertOnboardingEditable,
} = require("../../helpers/brands");

exports.verifyBankAndFetchDetails = async (payload, brandId) => {
  const accountNumber = payload.accountNumber?.toString()?.trim();

  if (brandId) {
    const brand = await Brand.findOne({ _id: brandId, isDeleted: false });
    if (!brand) throwError(404, "Brand not found.");
    // Refuse paid verifications while nothing is actionable — locked means an
    // admin decision is pending, or the brand is already approved.
    assertOnboardingEditable(await resolveOnboardingEditWindow(brand));
  }

  // Exclude this brand's own record, so a vendor re-verifying their own account
  // while fixing a rejection does not collide with themselves.
  const takenByAnotherBrand = await Bank.findOne({
    accountNumber,
    isDeleted: false,
    ...(brandId ? { brandId: { $ne: brandId } } : {}),
  }).select("_id");
  if (takenByAnotherBrand) {
    throwError(400, "This acoount number is already in use");
  }

  // Re-verifying an unchanged, already-successful account returns the same
  // answer, so reuse the stored provider response instead of paying again.
  if (brandId) {
    const own = await Bank.findOne({
      brandId,
      accountNumber,
      isDeleted: false,
    }).select("verificationResponse verificationStatus");
    if (
      own?.verificationResponse &&
      own.verificationStatus === PRIMARY_VERIFICATION_STATUSES.SUCCESS
    ) {
      return own.verificationResponse;
    }
  }

  return await fetchAPI(process.env.CGPEY_BANK_ENDPOINT, payload);
};
