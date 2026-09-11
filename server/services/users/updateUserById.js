const { ROLES } = require("../../constants");
const Customer = require("../../models/Customer");
const User = require("../../models/User");
const { throwError } = require("../../utils");
const { uploadImage, deleteImage } = require("../uploads");
const { applyIdentityChange } = require("../../helpers/users");
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
  /**
   * Identity keys are collected here and written by `applyIdentityChange` below,
   * never assigned directly — it is the only thing that keeps the `User` and the
   * role profile in step, and the only thing that decides the verified flags.
   */
  const identityChange = {};

  if (payload) {
    let { fullName, email, dob, appliedReferralCode } = payload;
    if (fullName) user.name = fullName?.toLowerCase();
    //  if (address) user.address = address?.toLowerCase();
    if (dob) {
      // if (!isAdult(dob)) throwError(400, "User must be at least 18 years old");
      user.dob = dob;
    }
    if (email && email.toLowerCase() !== user.email) {
      email = email.toLowerCase();
      const emailExists = await User.findOne({
        email,
        role: user.role,
        _id: { $ne: userId },
        isDeleted: false,
      });
      if (emailExists) {
        throwError(400, "Email already exists with another user");
      }
      /**
       * Written through `applyIdentityChange`, not by hand.
       *
       * This used to set `user.email` and `user.isEmailVerified = false` here
       * and then copy the address onto `Customer` sixty lines below — for
       * CUSTOMER only, so a vendor editing their email left `Brand.email`
       * pointing at the old address, and that is the copy invoices and the
       * approval mail actually read.
       *
       * `verified: false` because nothing here proves the address is theirs.
       * They confirm it with `POST /auth/email/verify`.
       */
      identityChange.email = email;
    }
    if (appliedReferralCode) user.appliedReferralCode = appliedReferralCode;
    /**
     * ⚠️ `mobile` stays out of this endpoint, and `whatsappNumber` cannot be
     * written here at all — `applyIdentityChange` refuses it without an OTP.
     * Both have their own verification flows; adding a second, unverified way to
     * set them is what left `isEmailVerified` unreachable in the first place.
     */
  }
  if (image) {
    if (user.image) await deleteImage(user.image);
    const imageUrl = await uploadImage(image.tempFilePath);
    user.image = imageUrl;
  }
  user.isSignUpCompleted = true;

  /**
   * Runs **after** the non-identity fields are set on the document and **before**
   * the save below, because it saves: one write carries the name, the date of
   * birth, the image and the address together. When no identity key changed it
   * returns without saving, which is why the `save()` below is unconditional.
   */
  await applyIdentityChange(user, identityChange, { verified: false });
  await user.save();

  if (isCustomer && customer) {
    customer.fullName = user.name;
    customer.dob = user.dob;
    customer.image = user.image;
    customer.isSignUpCompleted = true;
    /**
     * ⚠️ `customer.email` is **not** set here any more.
     *
     * `applyIdentityChange` already mirrored all three identity keys onto this
     * customer — and onto a `Brand` or `SubBrand` for the roles this block never
     * covered. Copying the address again here would be a second writer for one
     * field, which is how the two came to disagree in the first place.
     *
     * Re-read so the response carries what the mirror actually wrote rather than
     * the copy this function loaded before it ran.
     */
    await customer.save();
    customer = await Customer.findById(customer._id);
  }

  const { password, otp, ...userData } = user.toObject();
  return { userData, customerData: isCustomer ? customer : null };
};
