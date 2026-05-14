const WorkHours = require("../../model/WorkHours");
const { createItem } = require("../../db/dbServices");

exports.createWorkHours = async (payload) => {
  return await createItem(WorkHours, payload);
};
