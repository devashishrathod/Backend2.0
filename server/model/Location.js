const mongoose = require("mongoose");
const { isValidZipCode } = require("../validator/common");
const {
  userField,
  brandField,
  subBrandField,
} = require("./validMogooseObjectId");

const locationSchema = new mongoose.Schema(
  {
    user: userField,
    brand: brandField,
    subBrand: subBrandField,
    name: { type: String },
    shopOrBuildingNumber: { type: String },
    address: { type: String },
    area: { type: String },
    landMark: { type: String },
    state: { type: String },
    city: { type: String },
    district: { type: String },
    country: { type: String },
    street: { type: String },
    formattedAddress: { type: String },
    zipCode: {
      type: String,
      validate: {
        validator: function (v) {
          return isValidZipCode(this.country, v);
        },
        message: (props) =>
          `${props.value} is not a valid ZIP/postal code for country ${props.instance.country}`,
      },
    },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
      },
    },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

locationSchema.index(
  { location: "2dsphere" },
  {
    partialFilterExpression: {
      "location.coordinates": { $exists: true, $type: "array" },
    },
  }
);

// locationSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("Location", locationSchema);
