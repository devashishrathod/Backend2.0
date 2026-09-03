const User = require("../../models/User");
const { throwError } = require("../../utils");
const { ROLES, LOGIN_TYPES } = require("../../constants");
const { uploadImage } = require("../../services/uploads");
const {
  generateUniqueUserId,
  generateReferralCode,
} = require("../../helpers/users");

exports.registerUser = async (body, image) => {
  let { name, email, password, mobile, whatsappNumber, username, role } = body;
  email = email?.toLowerCase();
  name = name?.toLowerCase();
  username = username?.toLowerCase();
  role = role?.toUpperCase() || ROLES.ADMIN;
  let user;
  if (email) {
    user = await User.findOne({ email, role, isDeleted: false });
    if (user) throwError(400, "User with this email already exists");
  }
  if (whatsappNumber) {
    user = await User.findOne({ whatsappNumber, role, isDeleted: false });
    if (user) throwError(400, "User with whatsapp contact already exists");
  }
  if (mobile) {
    user = await User.findOne({ mobile, role, isDeleted: false });
    if (user) throwError(400, "User with mobile number already exists");
  }
  if (username) {
    user = await User.findOne({ username });
    if (user) throwError(400, "Username already taken");
  }
  let imageUrl;
  if (image) imageUrl = await uploadImage(image.tempFilePath);
  const userData = {
    name,
    password,
    email,
    mobile,
    username,
    whatsappNumber,
    role,
    image: imageUrl,
    loginType: LOGIN_TYPES.PASSWORD,
    uniqueId: await generateUniqueUserId(),
    referralCode: await generateReferralCode(),
    isLoggedIn: true,
    isOnline: true,
  };
  user = await User.create(userData);
  const token = user.getSignedJwtToken();
  return { user, token };
};
