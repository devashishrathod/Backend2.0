const Subscription = require("../../models/Subscription");
const { DURATION_MAP } = require("../../constants");
const { throwError } = require("../../utils");

const computeDuration = (type) => {
  const days = DURATION_MAP[type];
  if (!days)
    throwError(400, "Invalid subscription type for duration calculation");
  return days;
};

exports.updateSubscription = async (id, payload) => {
  const subscription = await Subscription.findOne({
    _id: id,
    isDeleted: false,
  });
  if (!subscription) throwError(404, "Subscription not found");

  const updatedType = payload.type || subscription.type;
  const updatedName = payload.name || subscription.name;

  const existing = await Subscription.findOne({
    _id: { $ne: id },
    name: updatedName,
    type: updatedType,
    isDeleted: false,
  });

  if (existing)
    throwError(
      409,
      `Subscription with this name for ${updatedType} plan already exists`,
    );

  if (payload.type) payload.durationInDays = computeDuration(payload.type);

  const updated = await Subscription.findOneAndUpdate(
    { _id: id, isDeleted: false },
    { $set: payload },
    { new: true },
  );

  if (!updated) throwError(404, "Subscription not found");
  return updated;
};
