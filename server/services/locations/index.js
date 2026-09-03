const { createLocation } = require("./createLocation");
const { getAllLocations } = require("./getAllLocations");
const { getLocation } = require("./getLocation");
const { updateLocation } = require("./updateLocation");
const { upsertLocation } = require("./upsertLocation");
const { deleteLocation } = require("./deleteLocation");

module.exports = {
  createLocation,
  getAllLocations,
  getLocation,
  updateLocation,
  upsertLocation,
  deleteLocation,
};
