const mongoose = require("mongoose");
const validator = require("validator");
const { DEFAULT_IMAGES } = require("../constants");
const { isValidPhoneNumber } = require("../validator/common");
const { locationField, bankAccountField } = require("./validMogooseObjectId");

const employeeSchema = new mongoose.Schema(
  {
    name: { type: String },
    dob: { type: String },
    location: locationField,
    bankAccount: bankAccountField,
    email: {
      type: String,
      lowercase: true,
      trim: true,
      validate: {
        validator: validator.isEmail,
        message: (props) => `${props.value} is not a valid email address`,
      },
    },
    whatsappNumber: {
      type: String,
      validate: {
        validator: isValidPhoneNumber,
        message: (props) => `${props.value} is not a valid WhatsApp number`,
      },
    },
    referCode: { type: String, unique: true },
    image: { type: String, default: DEFAULT_IMAGES.USER },
    uniqueId: { type: String, unique: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("Employee", employeeSchema);
