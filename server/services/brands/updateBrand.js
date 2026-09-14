const mongoose = require("mongoose");
const { toDisplayName } = require("../../helpers/common");
const Brand = require("../../models/Brand");
const User = require("../../models/User");
const SubCategory = require("../../models/SubCategory");
const { SCREENS } = require("../../constants");
const { DUPLICATE_KEY } = require("../../constants/mongo");
const { throwError } = require("../../utils");
const storage = require("../storage");
const { assertImageFile } = require("../../helpers/media");
const { UPLOAD_PURPOSE } = require("../../constants/storage");
const {
  applyIdentityChange,
  assertCanWriteIdentity,
} = require("../../helpers/users");

/**
 * ⚠️ `actor` is new, and it is not optional for a contact change.
 *
 * `email` and `mobile` on a brand are mirrors of the owning vendor's account
 * keys, so setting them here writes that vendor's **login identity**. The gate
 * lets the vendor edit their own and an admin edit anybody's; without an actor
 * there is nobody to check, so a contact change is refused rather than assumed.
 */
/**
 * The brand's two pictures, handled identically.
 *
 * They differ only in which field they land on and what the error calls them,
 * so they share one upload / replace / rollback path rather than two copies of
 * it that drift apart.
 */
const IMAGE_SLOTS = Object.freeze([
  {
    file: "logo",
    field: "logo",
    mediaField: "logoMedia",
    label: "Logo",
    purpose: UPLOAD_PURPOSE.BRAND_LOGO,
  },
  {
    file: "coverImage",
    field: "coverImage",
    mediaField: "coverImageMedia",
    label: "Cover image",
    purpose: UPLOAD_PURPOSE.BRAND_COVER,
  },
]);

exports.updateBrand = async (
  brandId,
  payload = {},
  files = null,
  actor = null,
) => {
  /**
   * ⚠️ `files` used to be the logo itself. It is an object of files now, because
   * the brand has two pictures — a single positional file could never grow a
   * second one without every caller changing shape.
   *
   * A bare file is still accepted so an older caller keeps working and means
   * what it always meant.
   */
  const uploads = files?.tempFilePath ? { logo: files } : (files ?? {});

  // Before the session opens, deliberately: a file this endpoint is never going
  // to accept should not cost a transaction, and a 422 raised inside
  // `withTransaction` would be rewritten as a 500 on the way out.
  for (const slot of IMAGE_SLOTS) {
    assertImageFile(uploads[slot.file], slot.label);
  }

  const session = await mongoose.startSession();
  /** `field → { previous, uploaded }`, so rollback knows what to undo. */
  const replaced = new Map();
  let brandResult = null;
  try {
    await session.withTransaction(async () => {
      const brand = await Brand.findOne({
        _id: brandId,
        isDeleted: false,
      }).session(session);

      if (!brand) throwError(404, "Brand not found!");

      const user = await User.findOne({
        _id: brand.userId,
        isDeleted: false,
      }).session(session);
      if (!user) throwError(404, "User not found!");

      const {
        brandName,
        email,
        mobile,
        description,
        joinedDate,
        subCategoryId,
        isOnboarding,
      } = payload;

      if (brandName) brand.brandName = toDisplayName(brandName);

      /**
       * ---------------- the contact keys go through the account ----------------
       *
       * These used to be written straight onto the brand. That left the vendor's
       * `User.email` pointing at the old address while `Brand.email` — the copy
       * that invoices, the approval mail and `notify()` actually read — held the
       * new one. Two values, no way to tell which was current.
       *
       * Now the account is the source and the brand is its mirror, so both move
       * together or neither does.
       *
       * ⚠️ Each one lands **unverified**. Nothing here proves the vendor owns the
       * address or the number; they confirm it with `POST /auth/email/verify` or
       * `POST /auth/mobile/verify`. That is also what stops this endpoint from
       * being a way into somebody else's account.
       */
      if (email !== undefined || mobile !== undefined) {
        await assertCanWriteIdentity(actor, user);

        /**
         * ⚠️ The polite refusal; `user_{email,mobile}_role_unique` is the guard.
         *
         * `Brand.email` carries no unique index and never did, so this write used
         * to be unconditional. It now lands on `User`, where a partial unique
         * index exists — so a value already held by another vendor is refused by
         * the database, and without this check that arrives as a `422` naming an
         * index the vendor has never heard of.
         */
        for (const [field, value] of [
          ["email", email],
          ["mobile", mobile],
        ]) {
          if (value === undefined) continue;
          const taken = await User.findOne({
            [field]: value,
            role: user.role,
            _id: { $ne: user._id },
            isDeleted: false,
          })
            .select("_id")
            .session(session)
            .lean();
          if (taken) {
            throwError(
              409,
              field === "email"
                ? "That email address is already in use on another account."
                : "That mobile number is already in use on another account.",
            );
          }
        }

        try {
          await applyIdentityChange(
            user,
            { email, mobile },
            /**
             * `profile: brand` — the brand is already loaded and this same
             * transaction saves it below. Letting the helper look it up again
             * would put two documents for one row in flight.
             */
            { verified: false, session, profile: brand },
          );
        } catch (error) {
          // The check above is a read and reserves nothing; two vendors can set
          // the same address in the same instant and both pass it. The index
          // refuses the second, and this turns that into the same 409.
          if (error?.code === DUPLICATE_KEY) {
            throwError(
              409,
              "That email address or mobile number was taken while you were saving. Try a different one.",
            );
          }
          throw error;
        }
      }

      if (description) brand.description = description;
      if (joinedDate) brand.joinedDate = new Date(joinedDate);
      // `isActive` is deliberately not settable here. Switching a brand off is a
      // moderation action that has to be recorded and notified, so it lives on
      // `PUT /brands/admin/:brandId/status` — see the note in validator/brands.js.

      if (isOnboarding === true) {
        if (!subCategoryId) {
          throwError(400, "subCategoryId is required during onboarding!");
        }
        const subCategory = await SubCategory.findOne({
          _id: subCategoryId,
          isDeleted: false,
        }).session(session);
        if (!subCategory) throwError(404, "Sub-category not found!");
        if (!subCategory.categoryId) {
          throwError(
            400,
            "Selected sub-category is not linked with any category!",
          );
        }
        brand.subCategoryId = subCategory._id;
        brand.categoryId = subCategory.categoryId;
        user.currentScreen = SCREENS.UNDER_REVIEW;
        await user.save({ session });
      }
      for (const slot of IMAGE_SLOTS) {
        const file = uploads[slot.file];
        if (!file) continue;

        const uploaded = await storage.uploadFromPath({
          filePath: file.tempFilePath,
          originalFile: file,
          purpose: slot.purpose,
          entityId: brand._id,
        });
        // The previous pair, captured before it is overwritten.
        replaced.set(slot.field, {
          previous: toDeletable(brand[slot.mediaField], brand[slot.field]),
          uploaded,
        });
        brand[slot.field] = uploaded.url;
        brand[slot.mediaField] = toMediaDocument(uploaded);
      }
      brand.updatedAt = new Date();
      await brand.save({ session });
      brandResult = brand;
    });

    // The old pictures go only once the transaction has committed. Best effort:
    // an orphan is worth a log line, not a failed request for a change that has
    // already been saved.
    for (const [field, { previous }] of replaced) {
      if (!previous?.url) continue;
      try {
        await storage.deleteAsset(previous);
      } catch (deleteError) {
        console.error(`Failed to delete old brand ${field}:`, deleteError);
      }
    }
    return brandResult;
  } catch (error) {
    // The transaction rolled back, so the row never pointed at these. Without
    // this they would sit in storage referenced by nothing.
    for (const [field, { uploaded }] of replaced) {
      try {
        await storage.deleteAsset(uploaded);
      } catch (deleteError) {
        console.error(
          `Failed to cleanup uploaded brand ${field}:`,
          deleteError,
        );
      }
    }
    throw error;
  } finally {
    await session.endSession();
  }
};
