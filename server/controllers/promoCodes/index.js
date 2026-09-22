const { create } = require("./create");
const { update } = require("./update");
const { getAll } = require("./getAll");
const { get } = require("./get");
const { report } = require("./report");
const { deletePromo } = require("./deletePromo");
const { getForCustomer } = require("./getForCustomer");
const { getForVendor } = require("./getForVendor");

module.exports = {
  create,
  update,
  getAll,
  get,
  report,
  deletePromo,
  getForCustomer,
  getForVendor,
};
