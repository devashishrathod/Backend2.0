const mongoose = require("mongoose");
const { userField, locationField } = require("./validObjectId");
const { emailField, mobileField, whatsappField } = require("./contactFields");

const customerSchema = new mongoose.Schema(
  {
    userId: { ...userField, required: true },
    locationId: locationField,
    fullName: { type: String },
    dob: { type: Date },
    // Mirrors of `User`'s — same three descriptors, so the two copies can never
    // disagree about what is valid. See `models/contactFields.js`.
    email: emailField,
    mobile: mobileField,
    whatsappNumber: whatsappField,
    image: { type: String },
    uniqueId: { type: String, required: true, unique: true },
    isSignUpCompleted: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

/**
 * The account → profile hop, which every authenticated customer request makes.
 *
 * `resolveCustomerByUserId` runs `findOne({ userId, isActive, isDeleted })`, and
 * `repairRoleProfile` runs the same lookup on the login path. Until this existed
 * both were a collection scan of what will be the largest collection here.
 *
 * Deliberately **not** unique. One user does hold one customer, but the pairing
 * has only ever been enforced in code, and a duplicate left behind by a
 * half-finished signup before `createUserWithProfile` became transactional would
 * make the index refuse to build — silently, because Mongoose swallows that on
 * the `index` event.
 */
customerSchema.index({ userId: 1 });

/** The admin directory's default page: live customers, newest first. */
customerSchema.index({ isDeleted: 1, createdAt: -1 });

module.exports = mongoose.model("Customer", customerSchema);
