const WorkHours = require("../../model/WorkHours");
const { findOne } = require("../../db/dbServices");

exports.getWorkHoursBySubBrandId = async (id) => {
  return await findOne(WorkHours, { subBrand: id, isDeleted: false });
};
