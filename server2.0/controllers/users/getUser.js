const { asyncWrapper, sendSuccess } = require("../../utils");
const { getUserById } = require("../../services/users");

exports.getUser = asyncWrapper(async (req, res) => {
  // Always the caller. A `?userId=` override used to win over the token, which
  // made this "read any user's profile" for anyone holding any valid token —
  // and ObjectIds leak freely through `createdBy`, `followerId` and brand
  // lookups, so the targets were not hard to come by. Reading someone else's
  // profile belongs behind a dedicated admin endpoint, not a query parameter.
  const userId = req.userId;
  const user = await getUserById(userId);
  return sendSuccess(res, 200, "User fetched successfully", user);
});
