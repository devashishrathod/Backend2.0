const mongoose = require("mongoose");
const { brandField } = require("./validObjectId");
const {
  PRIMARY_VERIFICATION_PROVIDERS,
  PRIMARY_VERIFICATION_STATUSES,
  GST_REGISTRATION_STATUS,
  GST_TAXPAYER_TYPE,
} = require("../constants");
const { isValidGSTIN } = require("../validator/common");

const gstSchema = new mongoose.Schema(
  {
    brandId: { ...brandField, required: true, index: true },
    gstNumber: {
      type: String,
      required: true,
      uppercase: true,
      index: true,
      validate: {
        validator: (gstNumber) => isValidGSTIN(gstNumber),
        message: (props) => `${props.value} is not a valid GSTIN!`,
      },
    },
    legalName: { type: String, required: true },
    tradeName: { type: String },
    constitutionOfBusiness: { type: String, required: true },
    taxpayerType: {
      type: String,
      enum: Object.values(GST_TAXPAYER_TYPE),
      required: true,
    },
    registrationStatus: {
      type: String,
      enum: Object.values(GST_REGISTRATION_STATUS),
      required: true,
    },
    registrationDate: { type: Date, required: true },
    cancellationDate: { type: Date },
    filingStatus: { type: String },
    stateCode: { type: String },
    centerCode: { type: String },
    natureOfBusiness: [{ type: String }],
    stateJurisdiction: { type: String },
    stateJurisdictionCode: { type: String },
    address: {
      floorNumber: { type: String },
      buildingNumber: { type: String },
      buildingName: { type: String },
      location: { type: String, required: true },
      city: { type: String, required: true },
      district: { type: String, required: true },
      state: { type: String, required: true },
      pin: { type: String, required: true },
      country: { type: String, default: "India" },
      latitude: { type: String },
      longitude: { type: String },
      businessNature: { type: String },
    },
    lastUpdated: { type: Date },
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

gstSchema.index({ brandId: 1, gstNumber: 1 }, { unique: true });

module.exports = mongoose.model("GST", gstSchema);
