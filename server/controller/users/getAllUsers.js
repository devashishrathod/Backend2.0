const { getAllUsers } = require("../../service/userServices");
const { asyncWrapper, sendSuccess } = require("../../utils");

exports.getAllUsers = asyncWrapper(async (req, res, next) => {
  const result = await getAllUsers(req.query);
  return sendSuccess(res, 200, "Users fetched successfully", result);
});
