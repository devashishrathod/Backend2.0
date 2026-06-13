const User = require("../../models/User");
const Brand = require("../../models/Brand");
const PAN = require("../../models/PAN");
const GST = require("../../models/GST");
const Bank = require("../../models/Bank");
const SystemVerify = require("../../models/SystemVerify");
const {
  calculateSimilarity,
  normalizeBusinessEntity,
} = require("../../helpers/systemVerify");
const {
  ROLES,
  PRIMARY_VERIFICATION_STATUSES,
  GST_REGISTRATION_STATUS,
  SYSTEM_VERIFICATION_STATUS,
  BRAND_SYSTEM_VERIFY_UPDATED_BY,
  GST_TO_BRAND_ENTITY_MAP,
} = require("../../constants");
const { brandField } = require("../../models/validObjectId");

exports.verifyVendor = async (userId) => {
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

  const [pan, gst, bank] = await Promise.all([
    PAN.findById(brand.PANId),
    GST.findById(brand.GSTId),
    Bank.findById(brand.BankId),
  ]);

  let score = 0;
  const remarks = [];
  const flags = {};

  flags.panVerified =
    pan?.verificationStatus === PRIMARY_VERIFICATION_STATUSES.SUCCESS;

  if (flags.panVerified) score += 10;
  else remarks.push("PAN verification failed");

  flags.gstVerified =
    gst?.verificationStatus === PRIMARY_VERIFICATION_STATUSES.SUCCESS;

  if (flags.gstVerified) score += 10;
  else remarks.push("GST verification failed");

  flags.bankVerified =
    bank?.verificationStatus === PRIMARY_VERIFICATION_STATUSES.SUCCESS &&
    bank?.isVerified;

  if (flags.bankVerified) score += 10;
  else remarks.push("Bank verification failed");

  // PAN inside GST
  if (pan && gst) {
    const panFromGST = gst.gstNumber.substring(2, 12);
    if (panFromGST === pan.pan) score += 10;
    else remarks.push("PAN does not belong to GST");
  }

  // PAN ↔ GST
  const panGstScore = calculateSimilarity(pan?.fullName, gst?.legalName);
  flags.panMatchedWithGST = panGstScore >= 85;

  // PAN ↔ BRAND
  const panBrandScore = calculateSimilarity(
    pan?.fullName,
    brand?.legalBusinessName,
  );
  flags.panMatchedWithBrand = panBrandScore >= 85;

  // GST ↔ BRAND
  const gstBrandScore = calculateSimilarity(
    gst?.legalName,
    brand?.legalBusinessName,
  );
  flags.gstMatchedWithBrand = gstBrandScore >= 85;

  const avgNameScore = (panGstScore + panBrandScore + gstBrandScore) / 3;

  if (avgNameScore >= 85) score += 20;
  else remarks.push(`Business name mismatch (${avgNameScore.toFixed(2)}%)`);

  const nameMatch = {
    panGstScore,
    panBrandScore,
    gstBrandScore,
    averageScore: Number(avgNameScore.toFixed(2)),
  };
  // BANK NAME MATCH
  const bankPanScore = calculateSimilarity(
    bank?.accountHolderName,
    pan?.fullName,
  );

  const bankGstScore = calculateSimilarity(
    bank?.accountHolderName,
    gst?.legalName,
  );

  const bankBrandScore = calculateSimilarity(
    bank?.accountHolderName,
    brand?.legalBusinessName,
  );

  const bankHighest = Math.max(bankPanScore, bankGstScore, bankBrandScore);
  flags.bankMatched = bankHighest >= 85;

  if (flags.bankMatched) score += 15;
  else remarks.push(`Bank holder name mismatch (${bankHighest}%)`);

  const bankNameMatch = {
    bankPanScore,
    bankGstScore,
    bankBrandScore,
    highestScore: bankHighest,
  };

  //  GST ACTIVE
  flags.gstActive = gst?.registrationStatus === GST_REGISTRATION_STATUS.SUCCESS;
  if (flags.gstActive) score += 15;
  else remarks.push("GST not active");

  // GST CONSTITUTION ↔ BRAND ENTITY
  const gstConstitution = normalizeBusinessEntity(gst?.constitutionOfBusiness);
  const brandEntity = normalizeBusinessEntity(brand?.businessEntityType);
  const mappedBrandEntity = normalizeBusinessEntity(
    GST_TO_BRAND_ENTITY_MAP[gstConstitution],
  );

  flags.businessEntityMatched = mappedBrandEntity === brandEntity;
  if (flags.businessEntityMatched) score += 10;
  else {
    remarks.push(
      `Business constitution mismatch. GST: ${gst?.constitutionOfBusiness}, Brand: ${brand?.businessEntityType}`,
    );
  }

  const entityMatch = {
    gstConstitution: gst?.constitutionOfBusiness,
    brandEntityType: brand?.businessEntityType,
    matched: mappedBrandEntity === brandEntity,
  };

  // DUPLICATES
  const duplicatePANBrands = await PAN.find({
    _id: { $ne: pan?._id },
    pan: pan?.pan,
    isDeleted: false,
  }).distinct("brandId");

  const duplicateGSTBrands = await GST.find({
    _id: { $ne: gst?._id },
    gstNumber: gst?.gstNumber,
    isDeleted: false,
  }).distinct("brandId");

  const duplicateBankBrands = await Bank.find({
    _id: { $ne: bank?._id },
    accountNumber: bank?.accountNumber,
    isDeleted: false,
  }).distinct("brandId");

  const duplicateWhatsappBrands = await Brand.find({
    _id: { $ne: brand._id },
    whatsappNumber: brand.whatsappNumber,
    isDeleted: false,
  }).distinct("_id");

  let duplicateEmailBrands = [];
  if (brand.email) {
    duplicateEmailBrands = await Brand.find({
      _id: { $ne: brand._id },
      email: brand.email,
      isDeleted: false,
    }).distinct("_id");
  }

  flags.duplicatePAN = duplicatePANBrands.length > 0;
  flags.duplicateGST = duplicateGSTBrands.length > 0;
  flags.duplicateBank = duplicateBankBrands.length > 0;
  flags.duplicateWhatsapp = duplicateWhatsappBrands.length > 0;
  flags.duplicateEmail = duplicateEmailBrands.length > 0;

  if (
    flags.duplicatePAN ||
    flags.duplicateGST ||
    flags.duplicateBank ||
    flags.duplicateWhatsapp ||
    flags.duplicateEmail
  ) {
    score -= 20;
    remarks.push("Duplicate merchant details detected");
  }
  const duplicateDetails = {
    panBrandIds: duplicatePANBrands,
    gstBrandIds: duplicateGSTBrands,
    bankBrandIds: duplicateBankBrands,
    whatsappBrandIds: duplicateWhatsappBrands,
    emailBrandIds: duplicateEmailBrands,
  };

  let status = SYSTEM_VERIFICATION_STATUS.REJECTED;
  let verifiedAt;
  if (score >= 90) {
    status = SYSTEM_VERIFICATION_STATUS.APPROVED;
    verifiedAt = new Date();
  } else if (score >= 75) status = SYSTEM_VERIFICATION_STATUS.MANUAL_REVIEW;

  const systemVerify = await SystemVerify.create({
    brandId,
    score,
    status,
    flags,
    nameMatch,
    bankNameMatch,
    entityMatch,
    duplicateDetails,
    remarks,
    verifiedAt,
  });

  if (brand.systemVerifyId) {
    const existing = await SystemVerify.findById(brand.systemVerifyId);
    if (
      existing &&
      !existing.isDeleted &&
      !existing.isRejected &&
      existing.status !== SYSTEM_VERIFICATION_STATUS.REJECTED
    ) {
      await SystemVerify.findOneAndUpdate(
        { _id: brand.systemVerifyId, isDeleted: false },
        {
          isRejected: true,
          status: SYSTEM_VERIFICATION_STATUS.REJECTED,
          rejectedBy: BRAND_SYSTEM_VERIFY_UPDATED_BY.SYSTEM,
          rejectedAt: new Date(),
        },
      );
    } else {
      await SystemVerify.findByIdAndUpdate(
        { _id: brand.systemVerifyId },
        { isDeleted: true },
      );
    }
  }
  brand.systemVerifyId = systemVerify._id;
  await brand.save();
  return systemVerify;
};
