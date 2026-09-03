const mongoose = require("mongoose");
const { brandField } = require("./validObjectId");
const {
  PRIMARY_VERIFICATION_PROVIDERS,
  PRIMARY_VERIFICATION_STATUSES,
  PAN_TYPES,
  GENDERS,
} = require("../constants");
const { isValidPAN, isValidAadhar } = require("../validator/common");

const panSchema = new mongoose.Schema(
  {
    brandId: {
      ...brandField,
      required: true,
      index: true,
    },
    pan: {
      type: String,
      required: true,
      uppercase: true,
      validate: {
        validator: (pan) => isValidPAN(pan),
        message: (props) => `${props.value} is not a valid PAN!`,
      },
      index: true,
    },
    panType: {
      type: String,
      required: true,
      enum: Object.values(PAN_TYPES),
    },
    fullName: { type: String, required: true },
    firstName: { type: String },
    middleName: { type: String },
    lastName: { type: String },
    gender: { type: String, enum: Object.values(GENDERS) },
    dob: { type: Date },
    aadhaarNumber: {
      type: String,
      validate: {
        validator: (aadhaarNumber) => isValidAadhar(aadhaarNumber),
        message: (props) => `${props.value} is not a valid Aadhaar number!`,
      },
    },
    isAadhaarLinked: { type: Boolean },
    addressDetails: {
      buildingName: { type: String },
      locality: { type: String },
      streetName: { type: String },
      pincode: { type: String },
      city: { type: String },
      state: { type: String },
      country: { type: String, default: "India" },
    },
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

panSchema.index({ brandId: 1, pan: 1 }, { unique: true });

module.exports = mongoose.model("PAN", panSchema);
