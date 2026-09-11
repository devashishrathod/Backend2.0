const mongoose = require("mongoose");
const { OUTLET_TYPES } = require("../constants");
const { isValidateStoreId } = require("../validator/common");
const { emailField, mobileField, whatsappField } = require("./contactFields");
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
    // Mirrors of the outlet manager's `User` — see `models/contactFields.js`.
    email: emailField,
    mobile: mobileField,
    whatsappNumber: whatsappField,
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
