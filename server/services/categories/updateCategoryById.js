const Category = require("../../models/Category");
const { sameNameAs } = require("../../helpers/common");
const { throwError, validateObjectId } = require("../../utils");
const storage = require("../storage");
const { assertImageFile, toMediaDocument, toDeletable } = require("../../helpers/media");
const { UPLOAD_PURPOSE } = require("../../constants/storage");

exports.updateCategoryById = async (id, payload = 0, image) => {
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
  assertImageFile(image, "Category image");

  if (image) {
    // ⚠️ Upload first, delete second. It used to be the other way round, so a
    // failed upload left the category with its old image already destroyed and
    // nothing to replace it — a broken tile in the customer's category list,
    // from a request that answered 500 and looked recoverable.
    const previous = toDeletable(category.imageMedia, category.image);
    const uploaded = await storage.uploadFromPath({
      filePath: image.tempFilePath,
      originalFile: image,
      purpose: UPLOAD_PURPOSE.CATEGORY_IMAGE,
      entityId: category._id,
    });
    category.image = uploaded.url;
    category.imageMedia = toMediaDocument(uploaded);
    /**
     * ⚠️ A category that never had its own picture still carries a URL — the
     * schema **defaults** `image` to a shared placeholder. `deleteAsset`
     * refuses those by URL, and now there is a second, plainer signal: a
     * default has no `imageMedia` at all.
     */
    if (previous?.url) await storage.deleteAsset(previous);
  }
  category.updatedAt = new Date();
  await category.save();
  return category;
};
