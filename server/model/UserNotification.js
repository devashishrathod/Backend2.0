const mongoose = require("mongoose");
const { userField, pushNotificationField } = require("./validMogooseObjectId");

const userNotificationSchema = new mongoose.Schema(
  {
    user: userField,
    pushNotification: pushNotificationField,
    title: { type: String, required: true },
    message: { type: String },
    image: { type: String },
    isRead: { type: Boolean, default: false },
    sentAt: { type: Date, default: Date.now },
    readAt: { type: Date },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("UserNotification", userNotificationSchema);
