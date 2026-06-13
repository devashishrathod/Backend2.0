const mongoose = require("mongoose");
const { brandField } = require("./validObjectId");
const {
  SYSTEM_VERIFICATION_STATUS,
  BRAND_SYSTEM_VERIFY_UPDATED_BY,
} = require("../constants");

const systemVerifySchema = new mongoose.Schema(
  {
    brandId: { ...brandField, required: true, index: true },
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
    verifiedBy: {
      type: String,
      enum: Object.values(BRAND_SYSTEM_VERIFY_UPDATED_BY),
      default: BRAND_SYSTEM_VERIFY_UPDATED_BY.SYSTEM,
    },
    rejectedBy: {
      type: String,
      enum: Object.values(BRAND_SYSTEM_VERIFY_UPDATED_BY),
    },
    isRejected: { type: Boolean, default: false },
    isReviewed: { type: Boolean, default: false },
    isAdminApproved: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

module.exports = mongoose.model("SystemVerify", systemVerifySchema);
