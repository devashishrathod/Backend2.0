const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { ROLES, LOGIN_TYPES, SCREENS } = require("../constants");
const { customerField, brandField, subBrandField } = require("./validObjectId");
const {
  isValidEmail,
  isValidUsername,
  isValidPhoneNumber,
} = require("../validator/common");

const userSchema = new mongoose.Schema(
  {
    customerId: customerField,
    brandId: brandField,
    subBrandId: subBrandField,
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
    // Not required: accounts created through an OTP flow (WhatsApp / email /
    // mobile) genuinely have no password. They used to all be given the same
    // shared DEFAULT_PASSWORD, which meant one known string logged into any of
    // them. Password login now refuses an account that never set one.
    password: { type: String },
    // When the user actually chose their own password. Absent = never set.
    passwordSetAt: { type: Date },
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
        validator: (mobile) => isValidPhoneNumber(mobile),
        message: (props) => `${props.value} is not a valid mobile number`,
      },
    },
    whatsappNumber: {
      type: String,
      validate: {
        validator: (whatsappNumber) => isValidPhoneNumber(whatsappNumber),
        message: (props) => `${props.value} is not a valid WhatsApp number`,
      },
    },
    username: {
      type: String,
      validate: {
        validator: (username) => isValidUsername(username),
        message: (props) => `${props.value} is not a valid username`,
      },
      unique: true,
      sparse: true,
    },
    referralCode: { type: String, unique: true },
    uniqueId: { type: String, required: true, unique: true },
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
    /**
     * ⚠️ Dead. Nothing in this codebase writes any of these — they are always
     * absent, including in the admin customer detail, which projects `meta` and
     * therefore shows an empty object to every admin who opens it.
     *
     * They are what the legacy backend used for push, one token per user. The
     * `DeviceToken` model replaced that and does it properly: one row per
     * install, with its platform, its failure count and a soft retire, so a
     * customer on a phone and a tablet keeps both. Reviving `meta.fcmToken`
     * would put a second, worse answer next to it.
     *
     * Kept only so an existing document does not lose fields on save. Do not
     * write to them; if you need per-device state, it belongs on `DeviceToken`.
     */
    meta: {
      fcmToken: { type: String },
      ipAddress: { type: String },
      deviceType: { type: String },
      deviceId: { type: String },
    },
    image: { type: String },
    currentScreen: { type: String, enum: Object.values(SCREENS) },
    isEmailVerified: { type: Boolean, default: false },
    isMobileVerified: { type: Boolean, default: false },
    isSignUpCompleted: { type: Boolean, default: false },
    isOnBoardingCompleted: { type: Boolean, default: false },
    isLoggedIn: { type: Boolean, default: false },
    isOnline: { type: Boolean },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },

    // ---------------------------------------------------------------------
    // Server-side session kill switch.
    //
    // Any JWT whose `iat` predates this instant is refused by the auth gate.
    // A JWT cannot be revoked — it is valid until it expires — so without this
    // there is no way to end a session that is already open.
    //
    // Stamped on **reactivation** rather than on deactivation. While an account
    // is off, `isActive` already refuses every request, and leaving the token
    // itself alive is what lets the few deactivation-aware endpoints (logout,
    // device unregister, reading the notice that explains the suspension) still
    // work. Stamping it on the way back in is what guarantees no token survives
    // the round trip: the vendor has to sign in fresh.
    //
    // Also the primitive for "sign out of all devices" and for ending sessions
    // on a password change.
    // ---------------------------------------------------------------------
    sessionInvalidatedAt: { type: Date },
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

// Returns false — rather than throwing inside bcrypt — when the account has no
// password at all, so every password login path fails closed.
userSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password || !enteredPassword) return false;
  return bcrypt.compare(enteredPassword, this.password);
};

// True only once the user has chosen their own password.
userSchema.methods.hasPassword = function () {
  return Boolean(this.password);
};

userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 10);
});

/**
 * The referral graph, read backwards.
 *
 * `referralCode` is already indexed by its `unique: true`, so "who owns this
 * code" is cheap. The opposite direction — "who came in on my code" — had no
 * index at all, and the admin customer detail screen asks exactly that. It is
 * the one view that catches a person farming their own referral bonus: a run of
 * accounts all carrying one code, created minutes apart, where no single account
 * looks wrong on its own.
 *
 * ⚠️ Partial, and **not** unique. Most users never applied anybody's code, and a
 * plain index would store an entry for every one of those nulls to answer a
 * query that never asks about them. `$type: "string"` keeps it to the rows that
 * actually carry a value. Unique would be wrong outright — a code is meant to be
 * used by many people.
 */
userSchema.index(
  { appliedReferralCode: 1 },
  {
    name: "user_appliedReferralCode",
    partialFilterExpression: { appliedReferralCode: { $type: "string" } },
  },
);

module.exports = mongoose.model("User", userSchema);
