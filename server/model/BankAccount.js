const mongoose = require("mongoose");
const { BANK_ACCOUNT_TYPES } = require("../constants");
const {
  userField,
  brandField,
  locationField,
} = require("./validMogooseObjectId");
const {
  isValidAccountNumber,
  isValidIFSC,
  isValidMICR,
  isValidUpiId,
} = require("../validator/common");

const bankAccountSchema = new mongoose.Schema(
  {
    user: userField,
    brand: brandField,
    accountType: { type: String, enum: [...Object.values(BANK_ACCOUNT_TYPES)] },
    bankName: { type: String },
    branchName: { type: String },
    branchLocation: locationField,
    holderName: { type: String },
    accountNumber: {
      type: String,
      validate: {
        validator: isValidAccountNumber,
        message: (props) => `${props.value} is not a valid account number`,
      },
    },
    ifscCode: {
      type: String,
      uppercase: true,
      validate: {
        validator: isValidIFSC,
        message: (props) => `${props.value} is not a valid IFSC code`,
      },
    },
    micrCode: {
      type: String,
      validate: {
        validator: isValidMICR,
        message: (props) => `${props.value} is not a valid MICR code`,
      },
    },
    upiId: {
      type: String,
      lowercase: true,
      validate: {
        validator: isValidUpiId,
        message: (props) => `${props.value} is not a valid UPI ID`,
      },
    },
    upiName: { type: String },
    isDeleted: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("BankAccount", bankAccountSchema);
