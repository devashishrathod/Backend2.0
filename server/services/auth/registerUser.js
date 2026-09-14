const mongoose = require("mongoose");

const User = require("../../models/User");
const { throwError } = require("../../utils");
const { ROLES, LOGIN_TYPES } = require("../../constants");
const { DUPLICATE_KEY } = require("../../constants/mongo");
const storage = require("../../services/storage");
const { assertImageFile } = require("../../helpers/media");
const { UPLOAD_PURPOSE } = require("../../constants/storage");
const {
  generateUniqueUserId,
  generateReferralCode,
  sanitizeUser,
} = require("../../helpers/users");

exports.registerUser = async (body, image) => {
  let { name, email, password, mobile, whatsappNumber, username, role } = body;
  email = email?.toLowerCase();
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
  // The avatar's key carries the user id, and the upload happens before the
  // insert — so the id is minted here. Mongo generates ids client-side anyway.
  const _id = new mongoose.Types.ObjectId();

  let uploaded = null;
  assertImageFile(image, "Profile photo");

  if (image) {
    uploaded = await storage.uploadFromPath({
      filePath: image.tempFilePath,
      originalFile: image,
      purpose: UPLOAD_PURPOSE.USER_AVATAR,
      entityId: _id,
    });
  }

  const userData = {
    _id,
    name,
    password,
    email,
    mobile,
    username,
    whatsappNumber,
    role,
    image: uploaded?.url,
    imageStorage: uploaded?.storage,
    loginType: LOGIN_TYPES.PASSWORD,
    uniqueId: await generateUniqueUserId(),
    referralCode: await generateReferralCode(),
    isLoggedIn: true,
    isOnline: true,
  };
  /**
   * ⚠️ The four existence checks above are the polite refusal; the index is the
   * guard.
   *
   * Each of them is a read, and a read reserves nothing — two admins creating
   * the same account at once both pass all four and both insert. Since
   * `user_{email,whatsappNumber,mobile}_role_unique` exist, the second write is
   * refused, and this turns that into the same message the check above would
   * have given rather than a driver error naming an index.
   */
  try {
    user = await User.create(userData);
  } catch (error) {
    if (error?.code === DUPLICATE_KEY) {
      const field = Object.keys(error.keyPattern || {}).find((k) => k !== "role");
      const label =
        {
          email: "email",
          whatsappNumber: "whatsapp contact",
          mobile: "mobile number",
          username: "username",
        }[field] || "identifier";
      throwError(400, `User with this ${label} already exists`);
    }
    throw error;
  }
  const token = user.getSignedJwtToken();
  /**
   * ⚠️ `User.create` returns the document it just wrote, hash included — a
   * projection is not available on a create, which is the case `sanitizeUser`
   * exists for. This endpoint mints accounts **with** a password, so it leaked
   * one every time.
   */
  return { user: sanitizeUser(user), token };
};
