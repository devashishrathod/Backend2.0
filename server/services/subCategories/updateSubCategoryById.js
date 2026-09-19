const SubCategory = require("../../models/SubCategory");
const { sameNameAs, toDisplayName } = require("../../helpers/common");
const Category = require("../../models/Category");
const { throwError, validateObjectId } = require("../../utils");
const storage = require("../storage");
const { acceptUpload } = storage;
const { assertImageFile, toMediaDocument, toDeletable } = require("../../helpers/media");
const { UPLOAD_PURPOSE } = require("../../constants/storage");

/** ⚠️ `actor` is new (U-5) — see `createSubCategory`. */
exports.updateSubCategoryById = async (actor, id, payload, image) => {
  validateObjectId(id, "SubCategory Id");
  const subcategory = await SubCategory.findById(id);
  if (!subcategory || subcategory.isDeleted) {
    throwError(404, "SubCategory not found");
  }
  if (payload) {
    let { name, description, categoryId, isActive } = payload;
    let category;
    if (categoryId) {
      validateObjectId(categoryId, "Category Id");
      category = await Category.findById(categoryId);
      if (!category || category.isDeleted) {
        throwError(404, "Category not found!");
      }
      subcategory.categoryId = categoryId;
    }
    if (name) {
      const existingSubCategorywithCategory = await SubCategory.findOne({
        _id: { $ne: id },
        // Case-insensitive — see `createCategory`.
        name: sameNameAs(name),
        categoryId: subcategory?.categoryId,
        isDeleted: false,
      });
      if (existingSubCategorywithCategory) {
        throwError(
          400,
          `Another Subcategory exists with this name for same category`,
        );
      }
      subcategory.name = toDisplayName(name);
    }
    if (name && categoryId) {
      const existingSubCategorywithCategory = await SubCategory.findOne({
        _id: { $ne: id },
        name: sameNameAs(name),
        categoryId,
        isDeleted: false,
      });
      if (existingSubCategorywithCategory) {
        throwError(
          400,
          `Another Subcategory exists with this name for ${category.name}`,
        );
      }
    }
    if (typeof isActive !== "undefined") {
      subcategory.isActive = !subcategory.isActive;
    }
    if (description) subcategory.description = description?.trim() || "";
  }
  assertImageFile(image, "Subcategory image");

  const uploadId = payload && payload.uploadId;

  /**
   * 🔴 Upload, **then save, then** delete — all three, in that order.
   *
   * The delete used to sit before the save. A `save()` that threw then left the
   * bytes gone and the row still pointing at them: a broken tile in the
   * customer's list, from a request that answered 500 and looked retryable, with
   * nothing left to re-point the row at. `updateCategoryById` had the same shape
   * and was fixed in U-2; this is the second of the three that were outside it.
   */
  let previous = null;
  if (image || uploadId) {
    previous = toDeletable(subcategory.imageMedia, subcategory.image);
    const uploaded = await acceptUpload(actor, {
      file: image,
      uploadId,
      purpose: UPLOAD_PURPOSE.SUBCATEGORY_IMAGE,
      entityId: subcategory._id,
    });
    subcategory.image = uploaded.url;
    subcategory.imageMedia = toMediaDocument(uploaded);
  }
  subcategory.updatedAt = new Date();
  await subcategory.save();

  /**
   * ⚠️ A sub-category that never had its own picture still carries a URL — the
   * schema **defaults** it, and that one URL is on every such row at once.
   * `deleteAsset` refuses those by URL.
   */
  if (previous?.url) {
    try {
      await storage.deleteAsset(previous);
    } catch (error) {
      /**
       * 🔴 Logged, not thrown. The row already points at the new picture, so the
       * customer sees the right thing; throwing would answer 500 for an update
       * that worked. What is left behind is one unreferenced object, which is
       * what `scripts/auditOrphans.js` exists to find.
       */
      console.error(
        `Failed to delete the old sub-category image (${previous.storage?.key || previous.url}):`,
        error?.message || error,
      );
    }
  }
  return subcategory;
};
