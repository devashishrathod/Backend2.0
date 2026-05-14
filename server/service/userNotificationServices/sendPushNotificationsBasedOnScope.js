const User = require("../../model/User");
const { sendMutlipleUsersNotification } = require("../../helpers/firebase");
const { createMultipleNotifications } = require("./createMutipleNotifications");
const { OFFERS_SCOPE, ROLES, SUGGESTION_STATUS } = require("../../constants");
const { asyncWrapper } = require("../../utils");

/**
 * Send push notifications based on scope
 * @param {Object} pushNotification - PushNotification document
 */
exports.sendPushNotificationsBasedOnScope = asyncWrapper(
  async (pushNotification) => {
    const { scope, users, title, description, image, status } =
      pushNotification;
    if (status !== SUGGESTION_STATUS.ACTIVE) return;
    let targetUsers = [];
    if (scope === OFFERS_SCOPE.ALL_USERS) {
      targetUsers = await User.find(
        { role: ROLES.USER, isActive: true },
        "_id fcmToken"
      );
    } else {
      targetUsers = await User.find(
        { _id: { $in: users }, isActive: true },
        "_id fcmToken"
      );
    }
    if (!targetUsers.length) return;
    const tokens = targetUsers.map((u) => u.fcmToken).filter(Boolean);
    const userIds = targetUsers.map((u) => u._id);
    const payload = { title, message: description, image };
    await sendMutlipleUsersNotification(tokens, payload);
    await createMultipleNotifications(userIds, pushNotification);
    console.log(`✅ Notifications sent to ${userIds.length} users.`);
  }
);
