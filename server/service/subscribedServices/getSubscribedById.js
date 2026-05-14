const Subscribed = require("../../model/Subscribed");
const { findOne } = require("../../db/dbServices");

exports.getSubscribedById = async (id) => {
  return await findOne(Subscribed, {
    _id: id,
    isDeleted: false,
    isActive: true,
  });
};
