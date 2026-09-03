const mongoose = require("mongoose");
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
const { recordBrandVerificationHistory } = require("../../helpers/brands");
const {
  notifyBrandUnderReview,
  notifyAdminsBrandAwaitingReview,
} = require("../../helpers/notifications");
const { throwError } = require("../../utils");
const {
  ROLES,
  PRIMARY_VERIFICATION_STATUSES,
  GST_REGISTRATION_STATUS,
  SYSTEM_VERIFICATION_STATUS,
  BRAND_SYSTEM_VERIFY_UPDATED_BY,
  GST_TO_BRAND_ENTITY_MAP,
  SCREENS,
} = require("../../constants");
const {
  BRAND_VERIFICATION_ACTION,
  BRAND_VERIFICATION_ACTOR,
} = require("../../constants/brandVerification");

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
    throwError(403, "You are not authorized to verify a brand.");
  }
  const brandId = user.brandId;
  if (!brandId) throwError(400, "Brand not found for user.");

  const brand = await Brand.findById(brandId);
  if (!brand || brand.isDeleted) throwError(404, "Brand not found.");

  // ---------------------------------------------------------------
  // RE-RUN GUARDS
  // System verification is allowed once per submission. A second run
  // is only a *resubmission* — permitted after a rejection, never
  // while the previous attempt is still waiting on the admin.
  // ---------------------------------------------------------------
  if (brand.isApproved) {
    throwError(
      400,
      "Your brand is already approved. Verification cannot be run again.",
    );
  }

  const previousSystemVerifyId = brand.systemVerifyId || null;
  if (previousSystemVerifyId) {
    const previous = await SystemVerify.findOne({
      _id: previousSystemVerifyId,
      isDeleted: false,
    }).select("status isRejected isRevoked isAdminApproved isSuperseded");

    if (previous && !previous.isSuperseded) {
      if (previous.isAdminApproved) {
        throwError(
          400,
          "Your brand is already approved. Verification cannot be run again.",
        );
      }
      // Rejected, or an approval that was later revoked — either way the
      // vendor is expected to fix the details and resubmit.
      const isReopened =
        previous.isRejected ||
        previous.isRevoked ||
        previous.status === SYSTEM_VERIFICATION_STATUS.REJECTED ||
        previous.status === SYSTEM_VERIFICATION_STATUS.REVOKED;
      if (!isReopened) {
        throwError(
          409,
          "Your brand verification is already under review. Please wait for the admin's decision.",
        );
      }
    }
  }

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

  const now = new Date();
  let status = SYSTEM_VERIFICATION_STATUS.REJECTED;
  let verifiedAt;
  if (score >= 90) {
    status = SYSTEM_VERIFICATION_STATUS.APPROVED;
    verifiedAt = now;
  } else if (score >= 75) status = SYSTEM_VERIFICATION_STATUS.MANUAL_REVIEW;

  const isSystemRejected = status === SYSTEM_VERIFICATION_STATUS.REJECTED;
  const attemptNumber = (brand.verificationAttemptCount || 0) + 1;
  const isResubmission = attemptNumber > 1;

  // ---------------------------------------------------------------
  // PERSIST
  // The system outcome is only half the decision — it lands on the
  // SystemVerify record for the admin to see, while the brand itself
  // is parked at UNDER_REVIEW no matter what the score says. Nothing
  // is auto-approved: brand.isApproved is only ever flipped by an
  // admin through reviewBrandVerification.
  // ---------------------------------------------------------------
  const session = await mongoose.startSession();
  let systemVerify = null;
  try {
    await session.withTransaction(async () => {
      const [created] = await SystemVerify.create(
        [
          {
            brandId,
            attemptNumber,
            score,
            status,
            flags,
            nameMatch,
            bankNameMatch,
            entityMatch,
            duplicateDetails,
            remarks,
            verifiedAt,
            verifiedBy: BRAND_SYSTEM_VERIFY_UPDATED_BY.SYSTEM,
            isRejected: isSystemRejected,
            ...(isSystemRejected && {
              rejectedBy: BRAND_SYSTEM_VERIFY_UPDATED_BY.SYSTEM,
              rejectedAt: now,
              rejectionReason: remarks.length
                ? remarks.join(" | ")
                : "Automatic verification score below the accepted threshold.",
            }),
          },
        ],
        { session },
      );
      systemVerify = created;

      // Retire the previous attempt — kept for the audit trail, but never
      // actionable again. (Older flows overwrote it as "rejected"; that
      // conflated "superseded" with a real rejection decision.)
      if (previousSystemVerifyId) {
        await SystemVerify.updateOne(
          { _id: previousSystemVerifyId, isDeleted: false },
          {
            $set: {
              isSuperseded: true,
              supersededAt: now,
              supersededById: created._id,
            },
          },
          { session },
        );
      }

      // Compare-and-swap on systemVerifyId: a double-submitted request loses
      // here instead of quietly creating a second attempt.
      const brandUpdate = await Brand.updateOne(
        {
          _id: brand._id,
          isDeleted: false,
          isApproved: { $ne: true },
          systemVerifyId: previousSystemVerifyId,
        },
        {
          $set: {
            systemVerifyId: created._id,
            status: SYSTEM_VERIFICATION_STATUS.UNDER_REVIEW,
            verificationAttemptCount: attemptNumber,
            verifiedBy: null,
            verifiedAt: null,
            reviewedByAdminId: null,
            reviewedAt: null,
            approvedByAdminId: null,
            approvedAt: null,
            rejectedByAdminId: null,
            rejectedAt: null,
            rejectionReason: null,
            isReviewed: false,
            isRejected: false,
            isApproved: false,
          },
        },
        { session },
      );
      if (brandUpdate.matchedCount !== 1) {
        throwError(
          409,
          "Brand state changed while verifying. Please refresh and try again.",
        );
      }

      await User.updateOne(
        { _id: user._id, isDeleted: false },
        { $set: { currentScreen: SCREENS.PARTNERSHIP_DEED } },
        { session },
      );

      await recordBrandVerificationHistory(
        {
          brandId: brand._id,
          systemVerifyId: created._id,
          action: isResubmission
            ? BRAND_VERIFICATION_ACTION.RESUBMITTED
            : BRAND_VERIFICATION_ACTION.SYSTEM_VERIFIED,
          performedByType: BRAND_VERIFICATION_ACTOR.SYSTEM,
          performedBy: user._id,
          attemptNumber,
          brandUniqueId: brand.uniqueId,
          merchantId: brand.merchantId,
          score,
          previousStatus: brand.status,
          newStatus: status,
          reason:
            isSystemRejected && remarks.length ? remarks.join(" | ") : null,
          metadata: {
            triggeredByType: BRAND_VERIFICATION_ACTOR.VENDOR,
            triggeredBy: user._id,
            isResubmission,
            previousSystemVerifyId,
            systemStatus: status,
            brandStatus: SYSTEM_VERIFICATION_STATUS.UNDER_REVIEW,
            flags,
            nameMatch,
            bankNameMatch,
            entityMatch,
            duplicateDetails,
            remarks,
          },
        },
        session,
      );
    });
  } finally {
    await session.endSession();
  }

  // ---------------------------------------------------------------------------
  // After the commit.
  //
  // Two notices, both outside the transaction: the vendor gets an
  // acknowledgement, and the admin team gets the one alert that means somebody
  // has to act. Neither may fail a submission that has already been recorded, so
  // neither is awaited for its delivery and neither throws.
  //
  // Nothing fires for the individual onboarding steps that led here. The vendor
  // is in the app filling them in, and four extra messages per signup is noise
  // the admin feed and the WhatsApp bill both pay for.
  //
  // The brand's own status is UNDER_REVIEW whatever the system scored — nothing
  // is auto-approved — so the vendor copy is the same either way, and the score
  // goes only to the admin.
  // ---------------------------------------------------------------------------
  const brandForNotice = {
    _id: brand._id,
    brandName: brand.brandName,
    uniqueId: brand.uniqueId,
    merchantId: brand.merchantId,
  };

  await Promise.all([
    notifyBrandUnderReview({
      brand: brandForNotice,
      attemptNumber,
      isResubmission,
      // Deliberately omitted from the vendor's notice: the KYC score is an
      // internal triage number, and a vendor reading "score 78" would draw
      // conclusions the score is not meant to support.
    }),
    notifyAdminsBrandAwaitingReview({
      brand: brandForNotice,
      attemptNumber,
      isResubmission,
      score,
      systemStatus: status,
    }),
  ]);

  // The full record goes back as before. This is only a KYC pass — the score
  // and remarks are what let the admin skim instead of re-checking every
  // document by hand, and more details get attached after this step anyway.
  //
  // A vendor-facing (score-free) shape is kept here for whenever the panel is
  // ready to switch over — the logic above already parks the brand at
  // UNDER_REVIEW regardless of what the system scored:
  //
  // return {
  //   brandId: brand._id,
  //   systemVerifyId: systemVerify._id,
  //   attemptNumber,
  //   status: SYSTEM_VERIFICATION_STATUS.UNDER_REVIEW,
  //   isReviewed: false,
  //   isApproved: false,
  //   isRejected: false,
  //   submittedAt: systemVerify.createdAt,
  //   currentScreen: SCREENS.PARTNERSHIP_DEED,
  // };
  return systemVerify;
};
