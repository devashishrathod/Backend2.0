const { asyncWrapper, sendSuccess } = require("../../utils");
const { createEmployee } = require("../../service/employeeServices");

exports.addEmployee = asyncWrapper(async (req, res) => {
  const image = req.files?.image;
  const data = await createEmployee(image, req.body);
  return sendSuccess(res, 201, "Employee added successfully", data);
});
