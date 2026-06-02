const { asyncWrapper, sendSuccess, throwError } = require("../../utils");
const { updateUserById } = require("../../services/users");
const { validateUpdateUser } = require("../../validator/users");

exports.updateUser = asyncWrapper(async (req, res) => {
  const userId = req.query?.userId || req.userId;
  const { error } = validateUpdateUser(req.body);
  if (error) throwError(422, error.details.map((d) => d.message).join(", "));
  const image = req.files?.image;
  const updatedUser = await updateUserById(userId, req.body, image);
  return sendSuccess(
    res,
    200,
    "User profile updated successfully",
    updatedUser
  );
});
