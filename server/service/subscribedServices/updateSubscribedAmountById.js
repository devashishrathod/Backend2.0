const Subscribed = require("../../model/Subscribed");
const { findOneAndUpdate } = require("../../db/dbServices");

exports.updateSubscribedAmountById = async (subscribedId, updatedData) => {
  return await findOneAndUpdate(
    Subscribed,
    { _id: subscribedId, isDeleted: false },
    updatedData
  );
};
