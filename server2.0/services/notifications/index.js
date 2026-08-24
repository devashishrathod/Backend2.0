const { getAllNotifications } = require("./getAllNotifications");
const { markNotificationsRead } = require("./markNotificationsRead");
const { broadcastNotification } = require("./broadcastNotification");

module.exports = {
  getAllNotifications,
  markNotificationsRead,
  broadcastNotification,
};
