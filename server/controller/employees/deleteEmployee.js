const { asyncWrapper, sendSuccess } = require("../../utils");
const { deleteEmployeeById } = require("../../service/employeeServices");

exports.deleteEmployee = asyncWrapper(async (req, res) => {
  const { id } = req.params;
  await deleteEmployeeById(id);
  return sendSuccess(res, 200, "Employee deleted successfully");
});
