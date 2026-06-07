const mongoose = require("mongoose");
const validator = require("validator");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { ROLES, LOGIN_TYPES } = require("../constants");
const { isValidPhoneNumber } = require("../validator/common");
const { customerField, brandField } = require("./validObjectId");

const userSchema = new mongoose.Schema(
  {
    customerId: customerField,
    brandId: brandField,
    name: { type: String },
    dob: { type: Date },
    role: {
      type: String,
      enum: Object.values(ROLES),
      default: ROLES.CUSTOMER,
    },
    loginType: {
      type: String,
      enum: Object.values(LOGIN_TYPES),
      default: LOGIN_TYPES.WHATSAPP,
    },
    password: { type: String, required: true },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      validate: {
        validator: validator.isEmail,
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
    username: { type: String },
    referralCode: { type: String, unique: true },
    uniqueId: { type: String, unique: true },
    appliedReferralCode: { type: String },
    referralCount: { type: Number, default: 0 },
    // notificationPreferences: {},
    // paymentPreferences: {},
    followerCount: { type: Number, default: 0 },
    followingCount: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    // profileOverview: { type: String },
    walletBalance: { type: Number, default: 0 },
    tCoinsBalance: { type: Number, default: 0 },

    // lastActivity: { type: Date, default: Date.now },
    // lastLocation: { lat: Number, lng: Number },
    // currentLocation: { lat: Number, lng: Number },
    meta: {
      fcmToken: { type: String },
      ipAddress: { type: String },
      deviceType: { type: String },
      deviceId: { type: String },
    },
    image: { type: String },
    currentScreen: { type: String, default: "LANDING_SCREEN" },
    isEmailVerified: { type: Boolean, default: false },
    isMobileVerified: { type: Boolean, default: false },
    isSignUpCompleted: { type: Boolean, default: false },
    isOnBoardingCompleted: { type: Boolean, default: false },
    isLoggedIn: { type: Boolean, default: false },
    isOnline: { type: Boolean },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

userSchema.methods.getSignedJwtToken = function () {
  return jwt.sign(
    {
      id: this._id,
      role: this.role,
      name: this.name,
      email: this.email,
      whatsappNumber: this.whatsappNumber,
      mobile: this.mobile,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRY },
  );
};

userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 10);
});

module.exports = mongoose.model("User", userSchema);
