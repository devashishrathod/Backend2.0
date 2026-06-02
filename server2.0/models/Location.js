const mongoose = require("mongoose");
const { isValidZipCode } = require("../validator/common");
const { userField } = require("./validObjectId");

const locationSchema = new mongoose.Schema(
  {
    userId: userField,
    name: { type: String },
    shopOrBuildingNumber: { type: String },
    address: { type: String },
    area: { type: String },
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
    isProductAddress: { type: Boolean, default: false },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

locationSchema.index(
  { location: "2dsphere" },
  {
    partialFilterExpression: { coordinates: { $exists: true, $type: "array" } },
  },
);

module.exports = mongoose.model("Location", locationSchema);
