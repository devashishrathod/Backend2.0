const PushNotification = require("../../model/PushNotification");
const Voucher = require("../../model/Voucher");
const { throwError } = require("../../utils");
const { OFFERS_SCOPE, SUGGESTION_STATUS } = require("../../constants");
const { uploadImage } = require("../uploadServices");
const {
  generateUniquePushNotificationId,
} = require("./generateUniquePushNotificationId");
const {
  sendPushNotificationsBasedOnScope,
} = require("../userNotificationServices");

exports.createPushNotification = async (voucherId, image, payload) => {
  let { scope, status, users, states, cities, title, description } = payload;
  const linkedVoucher = await Voucher.findById(voucherId);
  if (!linkedVoucher) throwError(404, "Voucher not found");
  if (!linkedVoucher.isActive || linkedVoucher.isDeleted)
    throwError(400, "Linked voucher is not active");
  if (!states || !cities) throwError(400, "States or cities are required");
  states = typeof states === "string" ? JSON.parse(states) : states;
  cities = typeof cities === "string" ? JSON.parse(cities) : cities;
  users = users ? (typeof users === "string" ? JSON.parse(users) : users) : [];
  const finalUsers = scope === OFFERS_SCOPE.ALL_USERS ? [] : users;
  // 3. Published date from voucher start date
  const publishedDate = linkedVoucher?.validFrom || new Date();
  const isActive = publishedDate <= new Date();
  const imageUrl = await uploadImage(image.tempFilePath);
  const notificationData = {
    voucher: voucherId,
    users: finalUsers,
    states,
    cities,
    scope,
    status,
    title,
    description,
    publishedDate,
    uniqueId: await generateUniquePushNotificationId(),
    image: imageUrl,
    isActive,
  };
  const pushNotification = await PushNotification.create(notificationData);
  if (status === SUGGESTION_STATUS.ACTIVE) {
    sendPushNotificationsBasedOnScope(pushNotification);
  }
  return pushNotification;
};
