const { ROLES } = require("../../constants");
const { toDisplayName } = require("../../helpers/common");
const Customer = require("../../models/Customer");
const User = require("../../models/User");
const { throwError } = require("../../utils");
const storage = require("../storage");
const { describeIncoming } = storage;
const { assertImageFile, toMediaDocument, toDeletable } = require("../../helpers/media");
const { UPLOAD_PURPOSE } = require("../../constants/storage");
const { applyIdentityChange } = require("../../helpers/users");
// const { isAdult } = require("../../helpers/users");

/**
 * ⚠️ `userId` **is** the actor here — this endpoint only ever edits the caller's
 * own account (`controllers/users/updateUser.js` takes it from the token and
 * ignores `?userId=`, which is how anyone used to edit anyone). So the facade
 * gets `{ userId }` and no signature change is needed.
 */
exports.updateUserById = async (userId, payload, image) => {
  const actor = { userId };
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
    if (fullName) user.name = toDisplayName(fullName);
    if (dob) {
      // if (!isAdult(dob)) throwError(400, "User must be at least 18 years old");
      user.dob = dob;
    }
    if (email && email.trim().toLowerCase() !== user.email) {
      email = email.trim().toLowerCase();
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
  assertImageFile(image, "Profile photo");

  /**
   * 🔴 Described before it is spent (U-5) — and the delete moved to **after**
   * the save, which is the third and last of the three surfaces that had it the
   * old way round (`updateCategoryById` and `updateSubCategoryById` were the
   * other two).
   *
   * A `save()` that threw used to leave the bytes gone and the row still
   * pointing at them: a profile with a dead photo URL and nothing to re-point it
   * at.
   */
  const incomingAvatar = await describeIncoming(actor, {
    file: image,
    uploadId: payload.uploadId,
    purpose: UPLOAD_PURPOSE.USER_AVATAR,
  });
  let previousAvatar = null;

  if (incomingAvatar) {
    /**
     * ⚠️ A customer's photo lives on their **`Customer`** row; every other
     * role's lives on `User`.
     *
     * Both used to hold it: the upload wrote `User.image` and the block below
     * copied it onto `Customer`. Two writers for one field is how the email
     * address came to disagree between the two — see the note further down —
     * and there was no reason for the picture to repeat the mistake.
     *
     * A vendor has no `Customer` row, so for them `User` is the only home.
     */
    const target = isCustomer ? customer : user;

    // ⚠️ The whole previous pair, captured before it is overwritten — the
    // delete needs the OLD storage, not the new one. It is deleted after the
    // save; see the note above this block.
    previousAvatar = toDeletable(target.imageMedia, target.image);
    const uploaded = await storage.acceptUpload(actor, {
      file: incomingAvatar.file,
      uploadId: incomingAvatar.uploadId,
      purpose: UPLOAD_PURPOSE.USER_AVATAR,
      entityId: user._id,
    });
    target.image = uploaded.url;
    target.imageMedia = toMediaDocument(uploaded);
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

  if (previousAvatar?.url) {
    try {
      await storage.deleteAsset(previousAvatar);
    } catch (error) {
      // 🔴 Logged, not thrown: the row already points at the new photo, so the
      // customer sees the right thing. Throwing would answer 500 for an update
      // that worked, and leave them retrying a save that already happened.
      console.error(
        `Failed to delete the old avatar (${previousAvatar.storage?.key || previousAvatar.url}):`,
        error?.message || error,
      );
    }
  }

  if (isCustomer && customer) {
    customer.fullName = user.name;
    customer.dob = user.dob;
    /**
     * ⚠️ `customer.image` is **not** copied from `user.image` any more.
     *
     * The upload above writes it directly, for the same reason `customer.email`
     * stopped being copied here: one field, one writer. `User.image` now stays
     * empty for a customer, which is what makes "where is their photo" a
     * question with one answer.
     */
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
