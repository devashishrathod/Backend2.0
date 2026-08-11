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
    userId: { ...userField, required: true },
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
        validator: function (v) {
          return isValidZipCode(this.country, v);
        },
        message: (props) =>
          `${props.value} is not a valid ZIP/postal code for country ${props.instance.country}`,
      },
    },
    coordinates: { type: [Number], default: [0, 0] }, // [lat , lng]
    isBrandAddress: { type: Boolean, default: false },
    isSubBrandAddress: { type: Boolean, default: false },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

locationSchema.index({
  userId: 1,
  isActive: 1,
  isDeleted: 1,
});

locationSchema.index(
  { userId: 1, isDefault: 1 },
  {
    unique: true,
    partialFilterExpression: {
      isDefault: true,
      isActive: true,
      isDeleted: false,
    },
  },
);

locationSchema.index(
  { location: "2dsphere" },
  {
    partialFilterExpression: { coordinates: { $exists: true, $type: "array" } },
  },
);

module.exports = mongoose.model("Location", locationSchema);
