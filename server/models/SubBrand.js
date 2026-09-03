const mongoose = require("mongoose");
const { OUTLET_TYPES } = require("../constants");
const {
  isValidEmail,
  isValidPhoneNumber,
  isValidateStoreId,
} = require("../validator/common");
const {
  userField,
  brandField,
  locationField,
  workHoursField,
} = require("./validObjectId");

const subBrandSchema = new mongoose.Schema(
  {
    userId: { ...userField, required: true },
    brandId: { ...brandField, required: true },
    locationId: locationField,
    workHoursId: workHoursField,
    joinedDate: { type: Date, default: Date.now },
    outletType: {
      type: String,
      enum: Object.values(OUTLET_TYPES),
      default: OUTLET_TYPES.OUTLET,
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
    storeId: {
      type: String,
      required: true,
      validate: {
        validator: isValidateStoreId,
        message: (props) => `${props.value} is not a valid Store Id`,
      },
      unique: true,
    },
    geo: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        validate: {
          validator: function (value) {
            if (!Array.isArray(value) || value.length !== 2) {
              return false;
            }
            const [lng, lat] = value;
            return (
              Number.isFinite(lng) &&
              Number.isFinite(lat) &&
              lng >= -180 &&
              lng <= 180 &&
              lat >= -90 &&
              lat <= 90
            );
          },
          message: "SubBrand geo coordinates must be [longitude, latitude].",
        },
        default: [0, 0],
      },
    },
    logo: { type: String },
    coverImage: { type: String },
    description: { type: String },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

subBrandSchema.index({ geo: "2dsphere" });

subBrandSchema.index({ isActive: 1, isDeleted: 1 });

subBrandSchema.index({ brandId: 1, isActive: 1, isDeleted: 1 });

subBrandSchema.index({ locationId: 1 });

subBrandSchema.index({ userId: 1, isActive: 1, isDeleted: 1 });

module.exports = mongoose.model("SubBrand", subBrandSchema);
