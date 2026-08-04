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
} = require("./validObjectId");
const {
  BUSINESS_REGISTRATION_STATUS,
  BUSINESS_ENTITY_TYPE,
} = require("../constants");

const brandSchema = new mongoose.Schema(
  {
    userId: { ...userField, required: true },
    PANId: PANField,
    GSTId: GSTField,
    BankId: BankField,
    systemVerifyId: systemVerifyField,
    locationId: locationField,
    subscribedId: subscribedField,
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
    logo: { type: String },
    coverImage: { type: String },
    hasAcceptedPartnershipDeed: { type: Boolean },
    isSubscribed: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

module.exports = mongoose.model("Brand", brandSchema);
