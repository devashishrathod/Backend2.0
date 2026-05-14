const { asyncWrapper, sendSuccess } = require("../../utils");
const {
  createPushNotification,
} = require("../../service/pushNotificationServices");

exports.createPushNotification = asyncWrapper(async (req, res, next) => {
  const { voucherId } = req.params;
  const image = req.files?.image;
  const data = await createPushNotification(voucherId, image, req.body);
  return sendSuccess(res, 201, "Push notification created successfully", data);
});
