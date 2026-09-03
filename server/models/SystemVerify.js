const mongoose = require("mongoose");
const { brandField, userField, systemVerifyField } = require("./validObjectId");
const {
  SYSTEM_VERIFICATION_STATUS,
  BRAND_SYSTEM_VERIFY_UPDATED_BY,
} = require("../constants");
const { BRAND_VERIFICATION_LIMITS } = require("../constants/brandVerification");

const systemVerifySchema = new mongoose.Schema(
  {
    brandId: { ...brandField, required: true, index: true },
    // 1 for the first automatic run, incremented on every vendor resubmission.
    attemptNumber: { type: Number, default: 1, min: 1 },
    score: { type: Number, default: 0 },
    status: {
      type: String,
      enum: Object.values(SYSTEM_VERIFICATION_STATUS),
      default: SYSTEM_VERIFICATION_STATUS.PENDING,
    },
    flags: {
      panVerified: { type: Boolean },
      gstVerified: { type: Boolean },
      bankVerified: { type: Boolean },
      panMatchedWithGST: { type: Boolean },
      panMatchedWithBrand: { type: Boolean },
      gstMatchedWithBrand: { type: Boolean },
      bankMatched: { type: Boolean },
      businessEntityMatched: { type: Boolean },
      gstActive: { type: Boolean },
      panEmbeddedInGST: { type: Boolean },
      duplicatePAN: { type: Boolean },
      duplicateGST: { type: Boolean },
      duplicateBank: { type: Boolean },
      duplicateWhatsapp: { type: Boolean },
      duplicateEmail: { type: Boolean },
    },
    nameMatch: {
      panGstScore: { type: Number },
      panBrandScore: { type: Number },
      gstBrandScore: { type: Number },
      averageScore: { type: Number },
    },
    bankNameMatch: {
      bankPanScore: { type: Number },
      bankGstScore: { type: Number },
      bankBrandScore: { type: Number },
      highestScore: { type: Number },
    },
    entityMatch: {
      gstConstitution: { type: String },
      brandEntityType: { type: String },
      matched: { type: Boolean },
    },
    duplicateDetails: {
      panBrandIds: [brandField],
      gstBrandIds: [brandField],
      bankBrandIds: [brandField],
      whatsappBrandIds: [brandField],
      emailBrandIds: [brandField],
    },
    remarks: [String],
    verifiedAt: { type: Date },
    rejectedAt: { type: Date },
    reviewedAt: { type: Date },
    adminApprovedAt: { type: Date },
    // SYSTEM / ADMIN — *who kind of actor* settled the record. The matching
    // *ByAdminId fields hold the actual admin user when it was a manual action.
    verifiedBy: {
      type: String,
      enum: Object.values(BRAND_SYSTEM_VERIFY_UPDATED_BY),
      default: BRAND_SYSTEM_VERIFY_UPDATED_BY.SYSTEM,
    },
    rejectedBy: {
      type: String,
      enum: Object.values(BRAND_SYSTEM_VERIFY_UPDATED_BY),
    },
    verifiedByAdminId: userField,
    rejectedByAdminId: userField,
    reviewedByAdminId: userField,
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: BRAND_VERIFICATION_LIMITS.MAX_REASON_LENGTH,
    },
    // Approval withdrawn after it was granted.
    revokedAt: { type: Date },
    revokedBy: {
      type: String,
      enum: Object.values(BRAND_SYSTEM_VERIFY_UPDATED_BY),
    },
    revokedByAdminId: userField,
    revokeReason: {
      type: String,
      trim: true,
      maxlength: BRAND_VERIFICATION_LIMITS.MAX_REASON_LENGTH,
    },
    isRevoked: { type: Boolean, default: false },
    isRejected: { type: Boolean, default: false },
    isReviewed: { type: Boolean, default: false },
    isAdminApproved: { type: Boolean, default: false },
    // Set when the vendor resubmits and a fresher record takes over. A
    // superseded record is kept for history but is never actionable again.
    isSuperseded: { type: Boolean, default: false },
    supersededAt: { type: Date },
    supersededById: systemVerifyField,
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

systemVerifySchema.index({ brandId: 1, attemptNumber: -1 });
systemVerifySchema.index({ status: 1, isReviewed: 1, createdAt: -1 });

module.exports = mongoose.model("SystemVerify", systemVerifySchema);
