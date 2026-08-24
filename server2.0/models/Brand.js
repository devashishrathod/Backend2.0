const mongoose = require("mongoose");
const {
  isValidEmail,
  isValidPhoneNumber,
  isValidateMerchantId,
} = require("../validator/common");
const {
  userField,
  PANField,
  GSTField,
  BankField,
  systemVerifyField,
  locationField,
  subscribedField,
  categoryField,
  subCategoryField,
  workHoursField,
  subBrandField,
} = require("./validObjectId");
const {
  BUSINESS_REGISTRATION_STATUS,
  BUSINESS_ENTITY_TYPE,
  SYSTEM_VERIFICATION_STATUS,
  BRAND_SYSTEM_VERIFY_UPDATED_BY,
} = require("../constants");
const { BRAND_VERIFICATION_LIMITS } = require("../constants/brandVerification");

const brandSchema = new mongoose.Schema(
  {
    userId: { ...userField, required: true },
    PANId: PANField,
    GSTId: GSTField,
    BankId: BankField,
    systemVerifyId: systemVerifyField,
    locationId: locationField,
    subscribedId: subscribedField,
    categoryId: categoryField,
    subCategoryId: subCategoryField,
    workHoursId: workHoursField,
    firstSubBrandId: subBrandField,
    // ---------- plan entitlement mirror (source of truth: Subscription) ------
    // Written only by helpers/brands/applyPlanEntitlements.js, which runs on
    // every activation, plan change, expiry and cancellation. `*Used` is
    // maintained atomically by helpers/subBrands/reserveOutletSlot.js and can
    // always be rebuilt from the SubBrand rows via recountBrandUsage.js.
    //
    // Four independent pools — none draws from another:
    //   subBrands  <- SubBrand rows with outletType OUTLET
    //   franchises <- SubBrand rows with outletType FRANCHISE
    //   vouchers   <- Voucher rows in a live status
    //   showcase   <- ShowcaseSection rows
    subBrandsLimit: { type: Number, default: 0, min: 0 },
    subBrandsUsed: { type: Number, default: 0, min: 0 },
    franchisesLimit: { type: Number, default: 0, min: 0 },
    franchisesUsed: { type: Number, default: 0, min: 0 },
    vouchersLimit: { type: Number, default: 0, min: 0 },
    vouchersUsed: { type: Number, default: 0, min: 0 },
    showcaseLimit: { type: Number, default: 0, min: 0 },
    showcaseUsed: { type: Number, default: 0, min: 0 },
    isSubBrandsUnlimited: { type: Boolean, default: false },
    isFranchisesUnlimited: { type: Boolean, default: false },
    isVouchersUnlimited: { type: Boolean, default: false },
    isShowcaseUnlimited: { type: Boolean, default: false },
    entitlementsSyncedAt: { type: Date },
    followersCount: { type: Number, default: 0 },
    avoidanceCount: { type: Number, default: 0 },
    joinedDate: { type: Date, default: Date.now },
    brandName: { type: String },
    legalBusinessName: { type: String },
    //  tradeName: { type: String },
    //  displayName: { type: String },
    businessRegistrationStatus: {
      type: String,
      enum: Object.values(BUSINESS_REGISTRATION_STATUS),
    },
    businessEntityType: {
      type: String,
      enum: Object.values(BUSINESS_ENTITY_TYPE),
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      validate: {
        validator: (email) => isValidEmail(email),
        message: (props) => `${props.value} is not a valid email address`,
      },
    },
    mobile: {
      type: String,
      validate: {
        validator: isValidPhoneNumber,
        message: (props) => `${props.value} is not a valid mobile number`,
      },
    },
    whatsappNumber: {
      type: String,
      validate: {
        validator: isValidPhoneNumber,
        message: (props) => `${props.value} is not a valid WhatsApp number`,
      },
    },
    uniqueId: { type: String, required: true, unique: true },
    merchantId: {
      type: String,
      required: true,
      validate: {
        validator: isValidateMerchantId,
        message: (props) => `${props.value} is not a valid Merchant token`,
      },
      unique: true,
    },
    // Vendor-facing status. It stays UNDER_REVIEW for the whole time the
    // system result is waiting on an admin — the raw system outcome lives on
    // the SystemVerify record and is only mirrored here once an admin acts.
    status: {
      type: String,
      enum: Object.values(SYSTEM_VERIFICATION_STATUS),
      default: SYSTEM_VERIFICATION_STATUS.PENDING,
    },
    logo: { type: String },
    coverImage: { type: String },
    description: { type: String },
    hasAcceptedPartnershipDeed: { type: Boolean },
    // ---------- verification mirror (source of truth: SystemVerify) ----------
    verificationAttemptCount: { type: Number, default: 0 },
    verifiedBy: {
      type: String,
      enum: Object.values(BRAND_SYSTEM_VERIFY_UPDATED_BY),
    },
    verifiedAt: { type: Date },
    reviewedByAdminId: userField,
    reviewedAt: { type: Date },
    approvedByAdminId: userField,
    approvedAt: { type: Date },
    rejectedByAdminId: userField,
    rejectedAt: { type: Date },
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: BRAND_VERIFICATION_LIMITS.MAX_REASON_LENGTH,
    },
    revokedByAdminId: userField,
    revokedAt: { type: Date },
    revokeReason: {
      type: String,
      trim: true,
      maxlength: BRAND_VERIFICATION_LIMITS.MAX_REASON_LENGTH,
    },
    // The vendor waits on the UNDER_REVIEW screen even after approval, so it
    // can show the congratulations state once. Flipped by the vendor tapping
    // through to the dashboard — that is also what moves currentScreen.
    isApprovalAcknowledged: { type: Boolean, default: false },
    approvalAcknowledgedAt: { type: Date },
    isReviewed: { type: Boolean, default: false },
    isRejected: { type: Boolean, default: false },
    isRevoked: { type: Boolean, default: false },
    isSubscribed: { type: Boolean, default: false },
    // True only after an admin has both reviewed and approved the brand.
    isApproved: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

module.exports = mongoose.model("Brand", brandSchema);
