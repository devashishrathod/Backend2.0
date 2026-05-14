const Subscribed = require("../../model/Subscribed");

exports.getAllSubscribedByUserId = async (userId) => {
  return await Subscribed.find({ user: userId }).lean();
};
