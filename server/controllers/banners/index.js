const { create } = require("./create");
const { get } = require("./get");
const { getAll } = require("./getAll");
const { update } = require("./update");
const { deleteBanner } = require("./deleteBanner");
const { getActiveForCustomer } = require("./getActiveForCustomer");

module.exports = {
  create,
  get,
  getAll,
  update,
  deleteBanner,
  getActiveForCustomer,
};
