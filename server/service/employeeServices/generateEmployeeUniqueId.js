const Employee = require("../../model/Employee");
const { findOne } = require("../../db/dbServices");

exports.generateEmployeeUniqueId = async () => {
  const prefix = "#Emp";
  while (true) {
    const randomNumber = Math.floor(100000 + Math.random() * 900000);
    const uniqueId = `${prefix}${randomNumber}`;
    const existingEmployee = await findOne(Employee, { uniqueId });
    if (!existingEmployee) return uniqueId;
  }
};
