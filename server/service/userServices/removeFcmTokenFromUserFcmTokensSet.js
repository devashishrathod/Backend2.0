const User = require("../../model/User");

/**
 * Remove Fcm Token from User Fcm Tokens Set
 * @param {String} userId - user's object id
 */
exports.removeFcmTokenFromUserFcmTokensSet = async (userId) => {
  return await User.findByIdAndUpdate(
    userId,
    { fcmToken: null },
    { new: true }
  );
};
