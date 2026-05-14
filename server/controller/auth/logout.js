// const {
//   removeFcmTokenFromUserFcmTokensSet,
// } = require("../../service/userServices");
// const { sendSuccess, sendError } = require("../../utils/index");

// exports.logout = async (req, res) => {
//   try {
//     const userId = req.payload._id;
//     console.log("User logout request received", userId, req.payload);
//     // const { token } = req.body;
//     await removeFcmTokenFromUserFcmTokensSet(userId);
//     // await unsubscibeFromTopic(
//     //   isProdServer()
//     //     ? firebaseTopics.SEND_TO_ALL
//     //     : firebaseTopics.SEND_TO_ALL_STAGING,
//     //   [token]
//     // );
//     return sendSuccess(res, 200, "Logout successful");
//   } catch (error) {
//     console.error("Error during logout:", error);
//     return sendError(res, 500, error.message);
//   }
// };
