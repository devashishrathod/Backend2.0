const { createSubscription } = require("./createSubscription");
const { getAllSubscriptions } = require("./getAllSubscriptions");
const { getSubscription } = require("./getSubscription");
const { updateSubscription } = require("./updateSubscription");
const { deleteSubscription } = require("./deleteSubscription");

module.exports = {
  createSubscription,
  getAllSubscriptions,
  getSubscription,
  updateSubscription,
  deleteSubscription,
};
