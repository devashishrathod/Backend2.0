const User = require("../../models/User");
const { throwError } = require("../../utils");
const { uploadImage, deleteImage } = require("../uploads");
const { isAdult } = require("../../helpers/users");

exports.updateUserById = async (userId, payload, image) => {
  const user = await User.findById(userId);
  if (!user || user?.isDeleted) throwError(404, "User not found");
  if (payload) {
    let { name, email, mobile, dob, address } = payload;
    if (name) user.name = name?.toLowerCase();
    if (address) user.address = address?.toLowerCase();
    if (dob) {
      if (!isAdult(dob)) throwError(400, "User must be at least 18 years old");
      user.dob = dob;
    }
    if (email && email !== user.email) {
      email = email?.toLowerCase();
      const emailExists = await User.findOne({
        email,
        role: user.role,
        _id: { $ne: userId },
        isDeleted: false,
      });
      if (emailExists) {
        throwError(400, "Email already exists with another user");
      }
      user.email = email;
      user.isEmailVerified = false;
    }
    if (mobile && mobile !== user.mobile) {
      const mobileExists = await User.findOne({
        mobile,
        role: user.role,
        _id: { $ne: userId },
        isDeleted: false,
      });
      if (mobileExists) {
        throwError(400, "Mobile number already exists with another user");
      }
      user.mobile = mobile;
      user.isMobileVerified = false;
    }
  }
  if (image) {
    if (user.image) await deleteImage(user.image);
    const imageUrl = await uploadImage(image.tempFilePath);
    user.image = imageUrl;
  }
  await user.save();
  const { password, otp, ...userData } = user.toObject();
  return userData;
};
