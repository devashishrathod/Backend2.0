const mongoose = require("mongoose");
const { userField, brandField } = require("./validMogooseObjectId");
const {
  isValidGSTIN,
  isValidPAN,
  isValidZipCode,
} = require("../validator/common");

const gstSchema = new mongoose.Schema(
  {
    companyName: { type: String },
    gstNumber: {
      type: String,
      sparse: true,
      validate: {
        validator: isValidGSTIN,
        message: (props) => `${props.value} is not a valid GST number`,
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
    country: { type: String, uppercase: true },
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
    user: userField,
    brand: brandField,
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("Gst", gstSchema);
