const mongoose = require("mongoose");
const { isValidZipCode } = require("../validator/common");
const {
  userField,
  brandField,
  subBrandField,
  customerField,
} = require("./validObjectId");
const { ADDRESS_TYPES } = require("../constants");

const locationSchema = new mongoose.Schema(
  {
    // userId: { ...userField, required: true },
    userId: userField,
    customerId: customerField,
    brandId: brandField,
    subBrandId: subBrandField,
    addressLine1: { type: String, required: true },
    addressLine2: { type: String },
    landmark: { type: String },
    addressType: {
      type: String,
      enum: Object.values(ADDRESS_TYPES),
      default: ADDRESS_TYPES.HOME,
    },
    // name: { type: String },
    // shopOrBuildingNumber: { type: String },
    city: { type: String },
    district: { type: String },
    state: { type: String },
    country: { type: String },
    formattedAddress: { type: String },
    zipcode: {
      type: String,
      validate: {
        validator: function (value) {
          //  if (!value) return true;
          return isValidZipCode(this.country, value);
        },
        message: (props) =>
          `${props.value} is not a valid ZIP/postal code for country ${props.instance.country}`,
      },
    },
    geo: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
        required: true,
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: function (value) {
            if (!Array.isArray(value)) return false;
            if (value.length !== 2) return false;
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
          message:
            "Geo coordinates must be [longitude, latitude] with valid values.",
        },
      },
    },
    isBrandAddress: { type: Boolean, default: false },
    isSubBrandAddress: { type: Boolean, default: false },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

locationSchema.index({ geo: "2dsphere" });

// locationSchema.index({ userId: 1, isActive: 1, isDeleted: 1 });

locationSchema.index({ customerId: 1, isActive: 1, isDeleted: 1 });

locationSchema.index({ subBrandId: 1, isActive: 1, isDeleted: 1 });

// locationSchema.index(
//   { userId: 1, isDefault: 1 },
//   {
//     unique: true,
//     partialFilterExpression: {
//       isDefault: true,
//       isActive: true,
//       isDeleted: false,
//     },
//   },
// );

module.exports = mongoose.model("Location", locationSchema);
