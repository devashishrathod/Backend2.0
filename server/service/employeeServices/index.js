const { createEmployee } = require("./createEmployee");
const { generateEmployeeUniqueId } = require("./generateEmployeeUniqueId");
const { deleteEmployeeById } = require("./deleteEmployeeById");
const {
  toggleActiveDeactiveEmployeeById,
} = require("./toggleActiveDeactiveEmployeeById");
const { getAllEmployees } = require("./getAllEmployees");

module.exports = {
  createEmployee,
  generateEmployeeUniqueId,
  deleteEmployeeById,
  toggleActiveDeactiveEmployeeById,
  getAllEmployees,
};
