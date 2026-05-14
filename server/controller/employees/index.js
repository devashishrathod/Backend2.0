const { addEmployee } = require("./addEmployee");
const { deleteEmployee } = require("./deleteEmployee");
const { getAllEmployees } = require("./getAllEmployees");
const { toggleActiveDeactive } = require("./toggleActiveDeactive");

module.exports = {
  addEmployee,
  deleteEmployee,
  toggleActiveDeactive,
  getAllEmployees,
};
