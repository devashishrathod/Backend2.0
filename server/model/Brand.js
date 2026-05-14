const mongoose = require("mongoose");
const validator = require("validator");
const { isValidPhoneNumber, isValidPAN } = require("../validator/common");
const {
  userField,
  categoryField,
  subCategoryField,
  locationField,
  workHoursField,
  gstField,
  subBrandsField,
  bankAccountField,
  subscribedField,
  transactionField,
  imagesField,
} = require("./validMogooseObjectId");

const brandSchema = new mongoose.Schema(
  {
    user: userField,
    name: { type: String },
    companyName: { type: String },
    logo: { type: String },
    cover: { type: String },
    slogan: { type: String },
    description: { type: String },
    companyEmail: {
      type: String,
      lowercase: true,
      trim: true,
      validate: {
        validator: validator.isEmail,
        message: (props) => `${props.value} is not a valid email address`,
      },
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      validate: {
        validator: validator.isEmail,
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
    panNumber: {
      type: String,
      sparse: true,
      validate: {
        validator: function (value) {
          if (value === null || value === undefined || value === "")
            return true;
          return isValidPAN(value);
        },
        message: (props) => `${props.value} is not a valid PAN number`,
      },
    },
    category: categoryField,
    subCategory: subCategoryField,
    location: locationField,
    workHours: workHoursField,
    gst: gstField,
    subBrands: subBrandsField,
    bankAccount: bankAccountField,
    subscribed: subscribedField,
    transaction: transactionField,
    gallery: imagesField,
    menu: imagesField,
    subBrandsLimit: { type: Number },
    subBrandsUsed: { type: Number },
    followersCount: { type: Number, default: 0 },
    joinedDate: { type: Date, default: Date.now },
    referMarketId: { type: String },
    referMarketMobile: { type: String },
    currentScreen: { type: String },
    isSignUpCompleted: { type: Boolean, default: false },
    isOnBoardingCompleted: { type: Boolean, default: false },
    isMarketPermission: { type: Boolean, default: true },
    isSubscribed: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    uniqueId: { type: String, unique: true },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("Brand", brandSchema);
