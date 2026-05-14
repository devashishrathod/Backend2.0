const admin = require("firebase-admin");
const serviceAccount = require("../../configs/firebaseServiceAccountKey.json");
const { asyncWrapper } = require("../../utils");

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

/**
 * Send FCM notification to a list of tokens
 * @param {Array} tokens - device tokens
 * @param {Object} payload - { title, message, image }
 */
exports.sendMutlipleUsersNotification = asyncWrapper(
  async (tokens, payload) => {
    if (!tokens || tokens.length === 0) return;
    const message = {
      notification: {
        title: payload.title,
        body: payload.message,
        image: payload.image || null,
      },
      data: payload.data || {},
    };
    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      ...message,
    });
    console.log("✅ Firebase Notifications sent:", response.successCount);
  }
);
