// const {
//   removeFcmTokenFromUserFcmTokensSet,
// } = require("../../service/userServices");
const { sendSuccess, sendError } = require("../../utils/index");

exports.logout = async (req, res) => {
  const userId = req.userId;
  console.log("User logout request received", userId);
  // const { token } = req.body;
  //   await removeFcmTokenFromUserFcmTokensSet(userId);
  // await unsubscibeFromTopic(
  //   isProdServer()
  //     ? firebaseTopics.SEND_TO_ALL
  //     : firebaseTopics.SEND_TO_ALL_STAGING,
  //   [token]
  // );
  return sendSuccess(res, 200, "Logout successful");
};
