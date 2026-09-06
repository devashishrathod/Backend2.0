const { getAllNotifications } = require("./getAllNotifications");
const { markNotificationsRead } = require("./markNotificationsRead");
const { broadcastNotification } = require("./broadcastNotification");
const {
  getMyNotificationPreferences,
  updateMyNotificationPreferences,
  getUserNotificationPreferences,
  updateUserNotificationPreferences,
} = require("./notificationPreferences");

module.exports = {
  getAllNotifications,
  markNotificationsRead,
  broadcastNotification,
  // A person's own channel toggles, and an admin's view of anybody's. All four
  // share one resolver and one presenter — see the file.
  getMyNotificationPreferences,
  updateMyNotificationPreferences,
  getUserNotificationPreferences,
  updateUserNotificationPreferences,
};
