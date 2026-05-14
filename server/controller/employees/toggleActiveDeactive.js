const { asyncWrapper, sendSuccess } = require("../../utils");
const {
  toggleActiveDeactiveEmployeeById,
} = require("../../service/employeeServices");

exports.toggleActiveDeactive = asyncWrapper(async (req, res) => {
  const { id } = req.params;
  const updated = await toggleActiveDeactiveEmployeeById(id);
  return sendSuccess(
    res,
    200,
    `Employee is now ${updated.isActive ? "Active" : "Inactive"}`
  );
});
