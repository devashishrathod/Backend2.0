const UserNotification = require("../../model/UserNotification");

/**
 * Create notification records for multiple users
 * @param {Array} userIds - list of ObjectIds
 * @param {Object} pushNotification - main PushNotification object
 */
exports.createMultipleNotifications = async (userIds, pushNotification) => {
  if (!userIds?.length) return;
  const notifications = userIds.map((userId) => ({
    user: userId,
    pushNotification: pushNotification._id,
    title: pushNotification.title,
    message: pushNotification.description,
    image: pushNotification.image,
  }));
  await UserNotification.insertMany(notifications);
};
