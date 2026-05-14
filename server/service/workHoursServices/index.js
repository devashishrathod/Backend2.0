const {
  getWorkHoursByUserAndBrandId,
} = require("./getWorkHoursByUserAndBrandId");
const { getWorkHoursBySubBrandId } = require("./getWorkHoursBySubBrandId");
const { createWorkHours } = require("./addWorkHours");

module.exports = {
  getWorkHoursByUserAndBrandId,
  getWorkHoursBySubBrandId,
  createWorkHours,
};
