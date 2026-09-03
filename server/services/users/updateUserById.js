const { ROLES } = require("../../constants");
const Customer = require("../../models/Customer");
const User = require("../../models/User");
const { throwError } = require("../../utils");
const { uploadImage, deleteImage } = require("../uploads");
// const { isAdult } = require("../../helpers/users");

exports.updateUserById = async (userId, payload, image) => {
  const user = await User.findById(userId);
  if (!user || user?.isDeleted) throwError(404, "User not found");
  const isCustomer = user.role === ROLES.CUSTOMER;
  let customer;
  if (isCustomer) {
    customer = await Customer.findOne({ userId });
    if (!customer || customer?.isDeleted) throwError(404, "Customer not found");
  }
  if (payload) {
    let { fullName, email, dob, appliedReferralCode } = payload;
    if (fullName) user.name = fullName?.toLowerCase();
    //  if (address) user.address = address?.toLowerCase();
    if (dob) {
      // if (!isAdult(dob)) throwError(400, "User must be at least 18 years old");
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
    if (appliedReferralCode) user.appliedReferralCode = appliedReferralCode;
    // if (mobile && mobile !== user.mobile) {
    //   const mobileExists = await User.findOne({
    //     mobile,
    //     role: user.role,
    //     _id: { $ne: userId },
    //     isDeleted: false,
    //   });
    //   if (mobileExists) {
    //     throwError(400, "Mobile number already exists with another user");
    //   }
    //   user.mobile = mobile;
    //   user.isMobileVerified = false;
    // }
  }
  if (image) {
    if (user.image) await deleteImage(user.image);
    const imageUrl = await uploadImage(image.tempFilePath);
    user.image = imageUrl;
  }
  user.isSignUpCompleted = true;
  await user.save();
  if (isCustomer && customer) {
    customer.fullName = user.name;
    customer.dob = user.dob;
    customer.email = user.email;
    customer.image = user.image;
    customer.isSignUpCompleted = true;
    await customer.save();
  }
  const { password, otp, ...userData } = user.toObject();
  return { userData, customerData: isCustomer ? customer : null };
};
