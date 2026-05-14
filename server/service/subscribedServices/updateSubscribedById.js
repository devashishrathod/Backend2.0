const Subscribed = require("../../model/Subscribed");
const { findOneAndUpdate } = require("../../db/dbServices");
const { getSubscribedById } = require("./getSubscribedById");

exports.updateSubscribedById = async (subscribedId, updatedData) => {
  const subscribed = await getSubscribedById(subscribedId);
  if (!subscribed) throw new Error("Subscribed document not found");
  return await findOneAndUpdate(
    Subscribed,
    { _id: subscribedId, isDeleted: false, isActive: true, isExpired: false },
    { $set: updatedData }
  );
};
