const Employee = require("../../model/Employee");
const { throwError } = require("../../utils");

exports.deleteEmployeeById = async (employeeId) => {
  const employee = await Employee.findOne({
    _id: employeeId,
    isDeleted: false,
  });
  if (!employee) throwError(404, "Employee not found");
  if (employee.isDeleted) throwError(400, "Employee already deleted");
  employee.isDeleted = true;
  employee.isActive = false;
  await employee.save();
};
