const bcrypt = require("bcryptjs");
const User = require("../../model/User");
const { throwError, generateReferralCode } = require("../../utils");
const { generateUniqueUserId } = require("../userServices");
const { uploadImage } = require("../uploadServices");
const { generateToken } = require("../../middleware");
const PASSWORD_SALT = process.env.SALT;

exports.registerUser = async (payload, image) => {
  const {
    name,
    email,
    mobile,
    whatsappNumber,
    password,
    role,
    address,
    fcmToken,
  } = payload;
  const checkUser = await User.findOne({
    $or: [{ email }, { mobile }, { whatsappNumber }],
    role,
  });
  if (checkUser) {
    throwError(400, "Email / Mobile or Whastapp Number already exists");
  }
  const hashedPass = await bcrypt.hash(password, parseInt(PASSWORD_SALT));
  if (!hashedPass) {
    throwError(400, "Use a defferent password! Failed to register!");
  }
  const uniqueId = await generateUniqueUserId();
  const user = await User.create({
    name,
    email,
    mobile,
    whatsappNumber,
    password: hashedPass,
    role,
    address,
    fcmToken,
    uniqueId,
    referCode: generateReferralCode(6),
  });
  if (image) {
    let imageUrl = await uploadImage(image.tempFilePath);
    user.image = imageUrl;
  }
  const result = await user.save();
  const token = await generateToken(result);
  return { result, token };
};
