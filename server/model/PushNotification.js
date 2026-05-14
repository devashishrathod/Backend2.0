const mongoose = require("mongoose");
const { OFFERS_SCOPE, SUGGESTION_STATUS } = require("../constants");
const { usersField, voucherField } = require("./validMogooseObjectId");

const stateSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true },
    countryCode: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ["state"], default: "state" },
  },
  { _id: false }
);

const citySchema = new mongoose.Schema(
  {
    countryCode: { type: String, required: true, trim: true },
    stateCode: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ["district", "city"], default: "district" },
  },
  { _id: false }
);

const pushNotificationSchema = new mongoose.Schema(
  {
    users: usersField,
    voucher: voucherField,
    states: { type: [stateSchema], required: true },
    cities: { type: [citySchema], required: true },
    scope: {
      type: String,
      enum: [...Object.values(OFFERS_SCOPE)],
      default: OFFERS_SCOPE.ALL_USERS,
    },
    status: {
      type: String,
      enum: [...Object.values(SUGGESTION_STATUS)],
      required: true,
    },
    image: { type: String, required: true },
    title: {
      type: String,
      required: [true, "Notification title is required"],
      minlength: 3,
      maxlength: 100,
      trim: true,
    },
    description: {
      type: String,
      maxlength: 500,
      default: "",
      trim: true,
    },
    publishedDate: { type: Date, required: true },
    uniqueId: { type: String, required: true, unique: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

pushNotificationSchema.index({ "states.name": 1 });
pushNotificationSchema.index({ "states.code": 1 });
pushNotificationSchema.index({ "cities.name": 1 });
pushNotificationSchema.index({ "cities.stateCode": 1 });
pushNotificationSchema.index({ publishedDate: -1, createdAt: -1 });

module.exports = mongoose.model("PushNotification", pushNotificationSchema);
