const mongoose = require("mongoose");
const validator = require("validator");
const { isValidPhoneNumber, isValidPAN } = require("../validator/common");
const {
  userField,
  brandField,
  categoryField,
  subCategoryField,
  locationField,
  workHoursField,
  gstField,
  bankAccountField,
  imagesField,
  vouchersField,
} = require("./validMogooseObjectId");

const subBrandSchema = new mongoose.Schema(
  {
    companyName: { type: String },
    logo: { type: String },
    cover: { type: String },
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
    user: userField,
    brand: brandField,
    category: categoryField,
    subCategory: subCategoryField,
    location: locationField,
    workHours: workHoursField,
    gst: gstField,
    bankAccount: bankAccountField,
    gallery: imagesField,
    menu: imagesField,
    vouchers: vouchersField,
    joinedDate: { type: Date, default: Date.now },
    isMarketPermission: { type: Boolean, default: true },
    isArchive: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    uniqueId: { type: String, unique: true },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("SubBrand", subBrandSchema);
