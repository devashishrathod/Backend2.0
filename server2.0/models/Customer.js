const mongoose = require("mongoose");
const { isValidPhoneNumber, isValidEmail } = require("../validator/common");
const { userField } = require("./validObjectId");

const customerSchema = new mongoose.Schema(
  {
    userId: { ...userField, required: true },
    fullName: { type: String },
    dob: { type: Date },
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
    image: { type: String },
    uniqueId: { type: String, required: true, unique: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

module.exports = mongoose.model("Customer", customerSchema);
