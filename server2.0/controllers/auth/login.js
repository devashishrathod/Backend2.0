const { asyncWrapper, sendSuccess, throwError } = require("../../utils");
const {
  loginWithEmailAndPassword,
  loginWithMobileAndPassword,
  loginWithUsernameAndPassword,
} = require("../../services/auth");
const { LOGIN_TYPES } = require("../../constants");

exports.login = asyncWrapper(async (req, res) => {
  const { type, ...data } = req.validatedData;
  let result;
  if (type === LOGIN_TYPES.EMAIL) {
    result = await loginWithEmailAndPassword(data);
  } else if (type === LOGIN_TYPES.MOBILE) {
    result = await loginWithMobileAndPassword(data);
  } else if (type === LOGIN_TYPES.USERNAME) {
    result = await loginWithUsernameAndPassword(data);
  } else {
    throwError(
      400,
      "Invalid login type! login with email, mobile, or username",
    );
  }
  return sendSuccess(res, 200, "User logged in successfully", result);
});
