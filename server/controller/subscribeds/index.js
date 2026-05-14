const { getAll } = require("./getAll");
const { getAllSubscribed } = require("./getAllSubscribed");
const { getCurrentSubscribed } = require("./getCurrentSubscribed");
const { subscribeToCoolingPlan } = require("./subscribeToCoolingPlan");

module.exports = {
  getAll,
  getAllSubscribed,
  getCurrentSubscribed,
  subscribeToCoolingPlan,
};
