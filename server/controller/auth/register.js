const { asyncWrapper, sendSuccess } = require("../../utils");
const { registerUser } = require("../../service/authServices");

exports.register = asyncWrapper(async (req, res) => {
  const image = req.files?.image;
  const result = await registerUser(req.body, image);
  return sendSuccess(res, 201, `User registered successfully`, result);
});
