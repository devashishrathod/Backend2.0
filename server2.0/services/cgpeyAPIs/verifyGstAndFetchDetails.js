const GST = require("../../models/GST");
const Brand = require("../../models/Brand");
const { fetchAPI } = require("../../helpers/cgpeyAPIs");
const { throwError } = require("../../utils");
const { PRIMARY_VERIFICATION_STATUSES } = require("../../constants");
const {
  resolveOnboardingEditWindow,
  assertOnboardingEditable,
} = require("../../helpers/brands");

exports.verifyGstAndFetchDetails = async (payload, brandId) => {
  let { gstNumber } = payload;
  gstNumber = gstNumber?.toUpperCase()?.trim();

  if (brandId) {
    const brand = await Brand.findOne({ _id: brandId, isDeleted: false });
    if (!brand) throwError(404, "Brand not found.");
    // Refuse paid verifications while nothing is actionable — locked means an
    // admin decision is pending, or the brand is already approved.
    assertOnboardingEditable(await resolveOnboardingEditWindow(brand));
  }

  // Exclude this brand's own record, so a vendor re-verifying their own GST
  // while fixing a rejection does not collide with themselves.
  const takenByAnotherBrand = await GST.findOne({
    gstNumber,
    isDeleted: false,
    ...(brandId ? { brandId: { $ne: brandId } } : {}),
  }).select("_id");
  if (takenByAnotherBrand) throwError(400, "GST detials already in use.");

  // Re-verifying an unchanged, already-successful GST returns the same answer,
  // so reuse the stored provider response instead of paying for it again.
  if (brandId) {
    const own = await GST.findOne({
      brandId,
      gstNumber,
      isDeleted: false,
    }).select("verificationResponse verificationStatus");
    if (
      own?.verificationResponse &&
      own.verificationStatus === PRIMARY_VERIFICATION_STATUSES.SUCCESS
    ) {
      return own.verificationResponse;
    }
  }

  return await fetchAPI(process.env.CGPEY_GST_ENDPOINT, payload);
};
