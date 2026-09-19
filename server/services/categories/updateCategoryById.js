const Category = require("../../models/Category");
const { sameNameAs, toDisplayName } = require("../../helpers/common");
const { throwError, validateObjectId } = require("../../utils");
const storage = require("../storage");
const { acceptUpload } = storage;
const { assertImageFile, toMediaDocument, toDeletable } = require("../../helpers/media");
const { UPLOAD_PURPOSE } = require("../../constants/storage");

/**
 * ⚠️ `actor` is new (U-2) — `acceptUpload` loads the upload intent by id **and**
 * owner, so a signed permission cannot be handed to somebody else.
 */
exports.updateCategoryById = async (actor, id, payload = 0, image) => {
  validateObjectId(id, "Category Id");
  const category = await Category.findById(id);
  if (!category || category.isDeleted) throwError(404, "Category not found");
  if (payload) {
    let { name, description, isActive } = payload;
    if (typeof isActive !== "undefined") category.isActive = !category.isActive;
    if (name) {
      const existing = await Category.findOne({
        _id: { $ne: id },
        // Case-insensitive — see `createCategory`.
        name: sameNameAs(name),
        isDeleted: false,
      });
      if (existing) throwError(400, "Another category exists with this name");
      category.name = toDisplayName(name);
    }
    if (description) category.description = description || "";
  }
  /**
   * ⚠️ Multipart road only — an exact mime allow-list, which the purpose's
   * `kinds` deliberately is not. See the note in `createCategory`.
   */
  assertImageFile(image, "Category image");

  const uploadId = payload && payload.uploadId;

  /**
   * 🔴 Upload, **then save, then** delete. All three, in that order.
   *
   * The delete used to come before the save, which still had the bug the
   * comment claimed to have fixed — just one step later. A `save()` that threw
   * left the bytes gone and the row still pointing at them: a broken tile in the
   * customer's category list, from a request that answered 500 and looked
   * retryable, with nothing to re-point the row at.
   *
   * The presigned road makes the order matter **more**, not less: `acceptUpload`
   * has two refusals the multipart road never had — a mismatched purpose and
   * somebody else's upload — and the old picture has to survive every one.
   *
   * ⚠️ This is also what the rest of the repo already does. `updateBrand`,
   * `updateSubBrand`, `updateBrandFeature` and `updateSectionMedia` all delete
   * after the save; category, subCategory and the avatar were the three outside
   * it. The other two are U-5's.
   */
  let previous = null;
  if (image || uploadId) {
    previous = toDeletable(category.imageMedia, category.image);
    const uploaded = await acceptUpload(actor, {
      file: image,
      uploadId,
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      entityId: category._id,
    });
    category.image = uploaded.url;
    category.imageMedia = toMediaDocument(uploaded);
  }
  category.updatedAt = new Date();
  await category.save();

  /**
   * ⚠️ A category that never had its own picture still carries a URL — the
   * schema **defaults** `image` to a shared placeholder, and that one URL is on
   * every such category at once. `deleteAsset` refuses those by URL, and there
   * is a second, plainer signal too: a default has no `imageMedia` at all.
   */
  if (previous?.url) {
    try {
      await storage.deleteAsset(previous);
    } catch (error) {
      /**
       * 🔴 Logged, not thrown — and this is the one place in this file where
       * that is right. The row already points at the new picture, so the
       * customer sees the correct thing; throwing would answer 500 for an
       * update that worked, and the admin would retry a save that has already
       * happened. What is left behind is one unreferenced object, which is
       * exactly what `scripts/auditOrphans.js` exists to find.
       */
      console.error(
        `Failed to delete the old category image (${previous.storage?.key || previous.url}):`,
        error?.message || error,
      );
    }
  }
  return category;
};
