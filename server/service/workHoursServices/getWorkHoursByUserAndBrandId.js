const WorkHours = require("../../model/WorkHours");
const { findOne } = require("../../db/dbServices");

exports.getWorkHoursByUserAndBrandId = async (brandId, userId) => {
  return await findOne(WorkHours, {
    brand: brandId,
    user: userId,
    isDeleted: false,
  });
};
