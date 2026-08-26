const { asyncWrapper, sendSuccess, throwError } = require("../../utils");
const { updateUserById } = require("../../services/users");
const { validateUpdateUser } = require("../../validator/users");

exports.updateUser = asyncWrapper(async (req, res) => {
  // Always the caller — see the note in getUser. The write side was the worse
  // half: `?userId=` let anyone change another account's name and email.
  const userId = req.userId;
  const { error, value } = validateUpdateUser(req.body);
  if (error) throwError(422, error.details.map((d) => d.message).join(", "));
  const image = req.files?.image;
  const updatedUser = await updateUserById(userId, value, image);
  return sendSuccess(
    res,
    200,
    "User profile updated successfully",
    updatedUser,
  );
});
