const mongoose = require("mongoose");
const { brandField } = require("./validObjectId");
const {
  BANK_ACCOUNT_TYPES,
  PRIMARY_VERIFICATION_PROVIDERS,
  PRIMARY_VERIFICATION_STATUSES,
} = require("../constants");
const { isValidAccountNumber, isValidIFSC } = require("../validator/common");

const bankSchema = new mongoose.Schema(
  {
    brandId: { ...brandField, required: true, index: true },
    accountHolderName: { type: String, required: true },
    accountNumber: {
      type: String,
      required: true,
      validate: {
        validator: (accountNumber) => isValidAccountNumber(accountNumber),
        message: (props) => `${props.value} is not a valid account number!`,
      },
      //   select: false,
    },
    maskedAccountNumber: { type: String, required: true },
    accountLast4Digits: { type: String, required: true },
    ifscCode: {
      type: String,
      required: true,
      uppercase: true,
      validate: {
        validator: (ifscCode) => isValidIFSC(ifscCode),
        message: (props) => `${props.value} is not a valid IFSC code!`,
      },
    },
    bankName: { type: String },
    branchName: { type: String },
    bankAddress: {
      type: Object,
      // addressLine1: { type: String },
      // city: { type: String },
      // district: { type: String },
      // state: { type: String },
      // pinCode: { type: String },
      // country: { type: String },
    },
    retrievalReferenceNumber: { type: String },
    user: {},
    accountType: {
      type: String,
      enum: Object.values(BANK_ACCOUNT_TYPES),
    },
    isNameMatch: { type: Boolean },
    matchingScore: { type: String },
    isValid: { type: Boolean, required: true },
    recommendedAction: { type: String, required: true },
    paymentMode: { type: String },
    failureReason: { type: String },
    npciErrorCode: { type: String },
    chargeable: { type: Boolean },
    userConsent: { type: Boolean },
    verificationResponse: { type: Object, required: true },
    verificationStatus: {
      type: String,
      enum: Object.values(PRIMARY_VERIFICATION_STATUSES),
      default: PRIMARY_VERIFICATION_STATUSES.PENDING,
    },
    verificationMessage: {
      type: String,
      required: function () {
        return (
          this.verificationStatus === PRIMARY_VERIFICATION_STATUSES.FAILED ||
          this.verificationStatus === PRIMARY_VERIFICATION_STATUSES.REJECTED
        );
      },
    },
    providerTransactionId: { type: String, required: true, index: true },
    providerRequestId: { type: String, required: true, index: true },
    verificationProvider: {
      type: String,
      enum: Object.values(PRIMARY_VERIFICATION_PROVIDERS),
      default: PRIMARY_VERIFICATION_PROVIDERS.CGPEY,
    },
    verifiedAt: {
      type: Date,
      required: function () {
        return (
          this.verificationStatus === PRIMARY_VERIFICATION_STATUSES.SUCCESS
        );
      },
    },
    isVerified: { type: Boolean, required: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

module.exports = mongoose.model("Bank", bankSchema);
