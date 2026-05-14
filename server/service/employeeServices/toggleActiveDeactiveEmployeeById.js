const Employee = require("../../model/Employee");
const { throwError } = require("../../utils");

exports.toggleActiveDeactiveEmployeeById = async (employeeId) => {
  const employee = await Employee.findOne({
    _id: employeeId,
    isDeleted: false,
  });
  if (!employee) throwError(404, "Employee not found");
  employee.isActive = !employee.isActive;
  await employee.save();
  return employee;
};
