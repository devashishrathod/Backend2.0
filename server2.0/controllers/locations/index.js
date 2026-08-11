const { create } = require("./create");
const { getAll } = require("./getAll");
const { get } = require("./get");
const { update } = require("./update");
const { upsert } = require("./upsert");
const { deleteLocation } = require("./deleteLocation");

module.exports = {
  create,
  getAll,
  get,
  update,
  upsert,
  deleteLocation,
};
