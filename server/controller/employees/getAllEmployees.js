const { asyncWrapper, sendSuccess } = require("../../utils");
const { getAllEmployees } = require("../../service/employeeServices");

exports.getAllEmployees = asyncWrapper(async (req, res) => {
  const result = await getAllEmployees(req.query);
  return sendSuccess(res, 200, "Employees fetched successfully", result);
});
