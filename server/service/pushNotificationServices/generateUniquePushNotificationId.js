const PushNotification = require("../../model/PushNotification");
const { findOne } = require("../../db/dbServices");

exports.generateUniquePushNotificationId = async () => {
  const prefix = "#PN";
  while (true) {
    const randomNumber = Math.floor(100000 + Math.random() * 900000);
    const uniqueId = `${prefix}${randomNumber}`;
    const existingPushNotification = await findOne(PushNotification, {
      uniqueId,
    });
    if (!existingPushNotification) return uniqueId;
  }
};
