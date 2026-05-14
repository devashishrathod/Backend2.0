const { createPushNotification } = require("./createPushNotification");
const {
  generateUniquePushNotificationId,
} = require("./generateUniquePushNotificationId");

module.exports = { createPushNotification, generateUniquePushNotificationId };
